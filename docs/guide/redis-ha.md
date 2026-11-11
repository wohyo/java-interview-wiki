# Redis 高可用与实战

## 高可用架构

### Replication（主从复制）

#### 什么是主从复制？

主从复制，是指将一台Redis服务器的数据，复制到其他的Redis服务器。前者称为主节点(master)，后者称为从节点(slave)；数据的复制是单向的，只能由主节点到从节点。

#### 主从复制的作用

1. 数据冗余：主从复制实现了数据的热备份，是持久化之外的一种数据冗余方式。
2. 故障恢复：当主节点出现问题时，可以由从节点提供服务，实现快速的故障恢复；实际上是一种服务的冗余。
3. 负载均衡：在主从复制的基础上，配合读写分离，可以由主节点提供写服务，由从节点提供读服务，分担服务器负载；尤其是在写少读多的场景下，通过多个从节点分担读负载，可以大大提高Redis服务器的并发量。
4. 高可用基石：主从复制还是哨兵和集群能够实施的基础，因此说主从复制是Redis高可用的基础。
#### 主从复制实现原理

主从复制过程主要可以分为3个阶段：连接建立阶段、数据同步阶段、命令传播阶段。

##### 连接建立阶段

该阶段的主要作用是在主从节点之间建立连接，为数据同步做好准备。

**步骤1：保存主节点信息**

slaveof命令是异步的，在从节点上执行slaveof命令，从节点立即向客户端返回ok，从节点服务器内部维护了两个字段，即masterhost和masterport字段，用于存储主节点的ip和port信息。

**步骤2：建立socket连接**

从节点每秒1次调用复制定时函数replicationCron()，如果发现了有主节点可以连接，便会根据主节点的ip和port，创建socket连接。

从节点为该socket建立一个专门处理复制工作的文件事件处理器，负责后续的复制工作，如接收RDB文件、接收命令传播等。

主节点接收到从节点的socket连接后（即accept之后），为该socket创建相应的客户端状态，并将从节点看做是连接到主节点的一个客户端，后面的步骤会以从节点向主节点发送命令请求的形式来进行。

**步骤3：发送ping命令**

从节点成为主节点的客户端之后，发送ping命令进行首次请求，目的是：检查socket连接是否可用，以及主节点当前是否能够处理请求。

从节点发送ping命令后，可能出现3种情况：

（1）返回pong：说明socket连接正常，且主节点当前可以处理请求，复制过程继续。

（2）超时：一定时间后从节点仍未收到主节点的回复，说明socket连接不可用，则从节点断开socket连接，并重连。

（3）返回pong以外的结果：如果主节点返回其他结果，如正在处理超时运行的脚本，说明主节点当前无法处理命令，则从节点断开socket连接，并重连。

**步骤4：身份验证**

如果从节点中设置了masterauth选项，则从节点需要向主节点进行身份验证；没有设置该选项，则不需要验证。从节点进行身份验证是通过向主节点发送auth命令进行的，auth命令的参数即为配置文件中的masterauth的值。

如果主节点设置密码的状态，与从节点masterauth的状态一致（一致是指都存在，且密码相同，或者都不存在），则身份验证通过，复制过程继续；如果不一致，则从节点断开socket连接，并重连。

**步骤5：发送从节点端口信息**

身份验证之后，从节点会向主节点发送其监听的端口号（前述例子中为6380），主节点将该信息保存到该从节点对应的客户端的slave_listening_port字段中；该端口信息除了在主节点中执行info Replication时显示以外，没有其他作用。

##### 数据同步阶段

主从节点之间的连接建立以后，便可以开始进行数据同步，该阶段可以理解为从节点数据的初始化。具体执行的方式是：从节点向主节点发送psync命令（Redis2.8以前是sync命令），开始同步。

数据同步阶段是主从复制最核心的阶段，根据主从节点当前状态的不同，分为**全量复制**和**部分复制**。

**全量复制**（首次同步或差距过大）：

```
① 从节点发送 psync ? -1
② 主节点回复 +FULLRESYNC <runid> <offset>，并 fork 子进程生成 RDB
③ 主节点把 RDB 发给从节点，从节点清空旧数据后加载
④ 主节点把生成 RDB 期间新产生的写命令存入 repl_backlog，RDB 发完后补发
```

**部分复制**（断线重连）：

```
① 从节点发送 psync <runid> <offset>
② 主节点检查 runid 是否匹配、offset 是否还在 repl_backlog 范围内
③ 是 → 回复 +CONTINUE，只补发 offset 之后的命令
④ 否 → 退化为全量复制
```

两个关键参数：

| 参数 | 作用 | 默认 |
| --- | --- | --- |
| `repl-backlog-size` | 复制积压缓冲区大小，决定断线后能补发多少数据 | 1MB |
| `repl-backlog-ttl` | 从节点全部断开后，backlog 保留多久 | 3600 秒 |

`repl_backlog` 是环形缓冲区，写满后旧数据被覆盖——覆盖了就只能全量复制。写流量大时要调大（如 64~256MB）。

##### 命令传播阶段

数据同步阶段完成后，主从节点进入命令传播阶段；在这个阶段主节点将自己执行的写命令发送给从节点，从节点接收命令并执行，从而保证主从节点数据的一致性。

需要注意的是，命令传播是异步的过程，即主节点发送写命令后并不会等待从节点的回复；因此实际上主从节点之间很难保持实时的一致性，延迟在所难免。数据不一致的程度，与主从节点之间的网络状况、主节点写命令的执行频率、以及主节点中的repl-disable-tcp-nodelay配置等有关。

### Sentinel（哨兵模式）

#### 为什么要引入哨兵模式？

Redis 的主从复制模式下，一旦主节点由于故障不能提供服务，需要手动将从节点晋升为主节点，同时还要通知客户端更新主节点地址，这种故障处理方式从一定程度上是无法接受的。

Redis 2.8 以后提供了 Redis Sentinel 哨兵机制来解决这个问题。

#### 什么是哨兵模式？

Redis Sentinel 是 Redis 高可用的实现方案。Sentinel 是一个管理多个 Redis 实例的工具，它可以实现对 Redis 的监控、通知、自动故障转移。

#### 哨兵模式的原理

哨兵模式的主要作用在于它能够自动完成故障发现和故障转移，并通知客户端，从而实现高可用。哨兵模式通常由一组 Sentinel 节点和一组（或多组）主从复制节点组成。

##### 心跳机制

（1）Sentinel与Redis Node

Redis Sentinel 是一个特殊的 Redis 节点。在哨兵模式创建时，需要通过配置指定 Sentinel 与 Redis Master Node 之间的关系，然后 Sentinel 会从主节点上获取所有从节点的信息，之后 Sentinel 会定时向主节点和从节点发送 info 命令获取其拓扑结构和状态信息。

（2）Sentinel与Sentinel

基于 Redis 的订阅发布功能， 每个 Sentinel 节点会向主节点的 `__sentinel__:hello` 频道上发送该 Sentinel 节点对于主节点的判断以及当前 Sentinel 节点的信息 ，同时每个 Sentinel 节点也会订阅该频道， 来获取其他 Sentinel 节点的信息以及它们对主节点的判断。

通过以上两步所有的 Sentinel 节点以及它们与所有的 Redis 节点之间都已经彼此感知到，之后每个 Sentinel 节点会向主节点、从节点、以及其余 Sentinel 节点定时发送 ping 命令作为心跳检测， 来确认这些节点是否可达。

##### 故障转移

每个 Sentinel 都会定时进行心跳检查，当发现主节点出现心跳检测超时的情况时，此时认为该主节点已经不可用，这种判定称为**主观下线**。

之后该 Sentinel 节点会通过 sentinel ismaster-down-by-addr 命令向其他 Sentinel 节点询问对主节点的判断， 当 quorum（法定人数） 个 Sentinel 节点都认为该节点故障时，则执行**客观下线**，即认为该节点已经不可用。这也同时解释了为什么必须需要一组 Sentinel 节点，因为单个 Sentinel 节点很容易对故障状态做出误判。

> 这里 quorum 的值是我们在哨兵模式搭建时指定的，后文会有说明，通常为 Sentinel 节点总数/2+1，即半数以上节点做出主观下线判断就可以执行客观下线。

因为故障转移的工作只需要一个 Sentinel 节点来完成，所以 Sentinel 节点之间会再做一次选举工作， 基于 Raft 算法选出一个 Sentinel 领导者来进行故障转移的工作。

被选举出的 Sentinel 领导者进行故障转移的具体步骤如下：

（1）在从节点列表中选出一个节点作为新的主节点

* 过滤不健康或者不满足要求的节点；
* 选择 `replica-priority`（从节点优先级，旧称 `slave-priority`，默认 100）最高的从节点， 如果存在则返回， 不存在则继续；
* 选择复制偏移量最大的从节点 ， 如果存在则返回， 不存在则继续；
* 选择 runid 最小的从节点。

（2）Sentinel 领导者节点会对选出来的从节点执行 `replicaof no one` 命令（旧称 `slaveof no one`）让其成为主节点。

（3）Sentinel 领导者节点会向剩余的从节点发送命令，让他们从新的主节点上复制数据。

（4）Sentinel 领导者会将原来的主节点更新为从节点， 并对其进行监控， 当其恢复后命令它去复制新的主节点。

### Cluster（集群）

#### 为什么要引入Cluster模式？

不管是主从模式还是哨兵模式都只能由一个master在写数据，在海量数据高并发场景，一个节点写数据容易出现瓶颈，引入Cluster模式可以实现多个节点同时写数据。

#### 什么是Cluster模式？

Redis-Cluster采用无中心结构，每个节点都保存数据，节点之间互相连接从而知道整个集群状态。

Cluster 模式其实就是多个主从复制结构组合起来，每一个主从复制结构可以看成一个节点；三主三从的 Cluster 集群就有三个节点。

#### Cluster模式的原理

##### Redis集群TCP端口

每个Redis集群节点都需要开启两个TCP监听端口，一个用于给客户端提供普通的Redis服务，常见为6379，另外一个用于集群间通信服务，一般为在普通端口基础上偏移10000如16379。

第二个端口用于集群总线，即使用二进制协议的节点到节点的通信通道。节点使用集群总线进行**故障检测**，**配置更新**，**故障转移授权**等。客户端永远不应尝试与集群总线端口通信，但始终使用正常的Redis命令端口，但请确保在防火墙中打开两个端口，否则Redis集群节点将无法通信。

##### Redis集群数据分片

Redis Cluster 没有使用一致性哈希，而是把整个键空间固定切成 **16384 个哈希槽（slot）**：

```
slot = CRC16(key) % 16384
```

每个主节点负责一部分槽，槽的分配可以手动指定，也可以让 `redis-cli --cluster` 自动均分。3 主集群通常是 0-5460、5461-10922、10923-16383。

**为什么是 16384**：节点间心跳包要携带槽位图（bitmap），16384 bit = 2KB，带宽可接受；槽太多心跳包变大，槽太少分布不均。这是作者在“心跳开销”和“分片粒度”之间的选择。

客户端访问的 key 不在当前节点时：

| 情况 | 响应 | 客户端动作 |
| --- | --- | --- |
| key 属于其他节点的槽 | `MOVED <slot> <ip:port>` | 更新本地槽位缓存，重定向到目标节点 |
| 槽正在迁移中 | `ASK <slot> <ip:port>` | 只对本次请求重定向，不更新缓存 |

集群扩容/缩容时，槽会逐个迁移：`CLUSTER SETSLOT <slot> IMPORTING/MIGRATING` + `MIGRATE` 命令搬数据。迁移过程中客户端可能收到 ASK，所以要有重定向处理（主流客户端都已内置）。

另外，Cluster 模式要求**同一个事务/同一批多 key 操作涉及的 key 在同一个槽**，用 `{tag}` 强制同槽：

```bash
SET {order:1001}:status paid
SET {order:1001}:amount 99
# 大括号里的内容相同 → CRC16 相同 → 落在同一个槽
```

### 常见应用场景

| 场景 | 数据结构 | 高可用要求 |
| --- | --- | --- |
| 缓存（商品、用户、配置） | String / Hash | 主从 + 哨兵即可，能容忍少量丢失 |
| 分布式锁 | String（SET NX PX）+ Lua | 主从异步复制有丢锁风险，强一致场景用 RedLock 或 ZK |
| 排行榜 / 延时队列 | ZSet | 主从 + 哨兵 |
| 会话共享 | Hash / String | 集群模式，避免单点 |
| 计数器 / 限流 | String（INCR）、Lua | 单 key 热点，必要时分片 |
| 消息队列 | List / Stream | 优先用专业 MQ，Redis 适合轻量场景 |
| 附近的人 / 签到 | GEO / Bitmap | 集群模式 |

选型顺序：**先看数据量和并发，再看一致性要求**。数据量小于单机内存、读多写少，主从 + 哨兵最省事；数据量超过单机、写并发高，再上 Cluster。

## 实战篇

### 使用docker搭建redis主从复制集群

#### 0. 目标

本地搭建三个redis实例（一主两备），实现效果：主实例插入数据后，备实例可以复制同步过去。

#### 1. 安装docker，运行docker

docker安装步骤省略，大家可以从官网下载并安装。

检查docker是否运行成功：

```plain
docker info
```
出现回显表示运行成功，可以做下一步操作了。
#### 2. 拉取redis镜像文件

执行以下命令默认拉取tag为latest的官方redis镜像

```plain
docker pull redis
```
#### 3. 准备好redis配置文件redis.conf

下载地址：[https://raw.githubusercontent.com/antirez/redis/5.0/redis.conf](https://raw.githubusercontent.com/antirez/redis/5.0/redis.conf)

拷贝为 3 份，如：redis01.conf, redis02.conf, redis03.conf

打开所有的配置文件，修改如下配置项：

* 注释掉只监听本地的配置项，即可远程连接：#bind 127.0.0.1
* 关闭保护模式 protected-mode no
* 打开AOF持久化开关 appendonly yes
#### 4. 启动redis实例

```plain
# 实例1
docker run -p 6381:6379 --name redis-server-01 -v /your/path/redis/conf/redis01.conf:/etc/redis/redis.conf -v /your/path/redis/data01:/data -d redis redis-server /etc/redis/redis.conf
# 实例2
docker run -p 6382:6379 --name redis-server-02 -v /your/path/redis/redis/conf/redis02.conf:/etc/redis/redis.conf -v /your/path/redis/data02:/data -d redis redis-server /etc/redis/redis.conf
# 实例3
docker run -p 6383:6379 --name redis-server-03 -v /your/path/redis/conf/redis03.conf:/etc/redis/redis.conf -v /your/path/redis/data03:/data -d redis redis-server /etc/redis/redis.conf
```
对以上命令简单解释：
* 参数-p 6381:6379，6381表示宿主机端口，6379表示容器实例端口，意思是将容器实例端口映射到宿主机端口。
* 参数--name redis-server-01，给容器实例命名。
* 参数-v /your/path/redis/conf/redis01.conf:/etc/redis/redis.conf，冒号前是宿主机配置文件路径，冒号后是容器的配置文件路径，意思是将容器实例的配置路径映射到宿主机的路径。
* 参数-v /your/path/redis/data01:/data，如上面意思相同。
* 选项-d表示以后台形式运行实例。
* 参数redis-server /etc/redis/redis.conf表示执行redis-server命令， /etc/redis/redis.conf表示以该配置文件启动redis实例，注意配置文件必须为redis-server命令的第一个参数。
#### 5. 配置主从复制集群

检查实例运行状态：

```plain
docker ps
```
回显有三个redis实例即为正常。
查询实例1：redis-server-01 运行的内部ip

```plain
docker inspect redis-server-01
```
通过回显可以看到："IPAddress": "172.17.0.4"
我们将实例1规划为主，另外两个实例自然为备了，通过将主的ip和port配置在备的配置文件中即可实现主从复制的效果。

修改redis02.conf和redis03.conf配置文件，找到replicaof选项（redis5.0之前是slaveof），修改为：

```plain
replicaof 172.17.0.4 6379
```
修改完毕，重启实例2和实例3：
```plain
docker restart redis-server-02
docker restart redis-server-03
```
检查实例1的状态是否为主，并且挂载两个备实例：
```plain
docker exec -it redis-server-01 redis-cli
127.0.0.1:6379> info
```
回显如下表示主从复制配置成功：
```plain
# Replication
role:master
connected_slaves:2
slave0:ip=172.17.0.3,port=6379,state=online,offset=84,lag=1
slave1:ip=172.17.0.2,port=6379,state=online,offset=84,lag=1
```
#### 6. 测试主从复制效果

连接redis实例1插入一条记录：

```plain
docker exec -it redis-server-01 redis-cli # 连接实例1
127.0.0.1:6379> set name ray  # 插入一条数据
OK  # 插入成功
```
连接redis实例2和实例3查看是否复制成功：
```plain
docker exec -it redis-server-02 redis-cli # 连接实例2
127.0.0.1:6379> get name
"ray" # 可以查到，表明从实例已经将主实例的数据同步过来了
```
至此，主从复制搭建和验证完成。
### 使用docker搭建redis主从复制+哨兵模式

搭建三个Sentinel实例+Redis实例

#### 0. 哨兵作用

* 监控（Monitoring）：哨兵会不断地检查主节点和从节点是否运作正常。
* 自动故障转移（Automatic failover）：当主节点不能正常工作时，哨兵会开始自动故障转移操作，它会将失效主节点的其中一个从节点升级为新的主节点，并让其他从节点改为复制新的主节点。
* 配置提供者（Configurationprovider）：客户端在初始化时，通过连接哨兵来获得当前 Redis 服务的主节点地址。
* 通知（Notification）：哨兵可以将故障转移的结果发送给客户端。
#### 1. 准备好哨兵配置文件sentinel.conf

官网下载源码包：[https://redis.io/download](https://redis.io/download) ，解压之后得到 sentinel.conf

拷贝为 3 份，如：sentinel01.conf, sentinel02.conf, sentinel03.conf

打开所有的配置文件，修改如下配置项：

* 关闭保护模式 `protected-mode no`
* 配置 Redis 主实例 ip 和端口：`sentinel monitor mymaster 172.17.0.4 6379 1`
* 配置日志文件：`logfile "sentinel.log"`
#### 2. 启动sentinel哨兵实例

```plain
# 实例1
docker run -p 26381:26379 -v /your/path/sentinel01.conf:/etc/redis/sentinel.conf -v /your/path/sentinel-data01:/data --name sentinel-01 -d redis redis-sentinel /etc/redis/sentinel.conf
# 实例2
docker run -p 26382:26379 -v /your/path/sentinel02.conf:/etc/redis/sentinel.conf -v /your/path/sentinel-data02:/data --name sentinel-02 -d redis redis-sentinel /etc/redis/sentinel.conf
# 实例3
docker run -p 26383:26379 -v /your/path/sentinel03.conf:/etc/redis/sentinel.conf -v /your/path/sentinel-data03:/data --name sentinel-03 -d redis redis-sentinel /etc/redis/sentinel.conf
```
#### 3. 测试哨兵模式

连接哨兵实例1，查询当前状态：

```plain
docker exec -it sentinel-01 redis-cli -p 26379
127.0.0.1:26379> info Sentinel
回显如下
# Sentinel
sentinel_masters:1
sentinel_tilt:0
sentinel_running_scripts:0
sentinel_scripts_queue_length:0
sentinel_simulate_failure_flags:0
master0:name=mymaster,status=ok,address=172.17.0.4:6379,slaves=2,sentinels=3
```
根据以上回显可以看出当前redis-server主实例ip为172.17.0.4
现在模拟一下故障，停掉redis-server主实例，预期哨兵集群会从两个备实例选出一个作为主实例，下面开始测试：

```plain
docker stop redis-server-01 # 停主实例
```
连接哨兵实例1查询当前主实例ip是否变换：
```plain
docker exec -it sentinel-01 redis-cli -p 26379
127.0.0.1:26379> info Sentinel
回显如下
# Sentinel
sentinel_masters:1
sentinel_tilt:0
sentinel_running_scripts:0
sentinel_scripts_queue_length:0
sentinel_simulate_failure_flags:0
master0:name=mymaster,status=ok,address=172.17.0.3:6379,slaves=2,sentinels=3
```
根据回显可以看出主ip已经换为172.17.0.3
至此，哨兵模式的故障转移验证完成。
