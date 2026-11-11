# Redis 数据结构与常用命令

**一句话定位**：Redis 有**九种数据类型**，但底层只有几种编码；面试要答的不是“会几个命令”，而是“**什么数据用什么类型、底层是什么编码、为什么**”。

## 一、五种基础类型

| 类型 | 结构 | 典型命令 | 典型场景 |
| --- | --- | --- | --- |
| String | 字符串/数字/二进制 | `SET` `GET` `INCR` `SETNX` `SETEX` `MSET` `GETSET` | 缓存、计数器、分布式锁、Session |
| List | 双向链表 | `LPUSH` `RPUSH` `LPOP` `RPOP` `LRANGE` `BLPOP` | 消息队列、最新列表、栈 |
| Hash | 字段-值映射 | `HSET` `HGET` `HGETALL` `HINCRBY` `HDEL` | 对象存储（用户信息、购物车） |
| Set | 无序去重集合 | `SADD` `SREM` `SISMEMBER` `SINTER` `SUNION` `SCARD` | 去重、共同好友、抽奖 |
| ZSet | 有序集合（score 排序） | `ZADD` `ZRANGE` `ZRANGEBYSCORE` `ZRANK` `ZINCRBY` | 排行榜、延迟队列、带权重的集合 |

### String

```bash
SET user:1:name "张三" EX 3600      # 设值 + 过期
GET user:1:name
INCR article:1:views               # 原子自增，返回新值
SETNX lock:order:1 "uuid"          # 不存在才设置（分布式锁基础）
MSET k1 v1 k2 v2                   # 批量设值
```

String 最大 512MB。数字类型的 String 可以直接 `INCR/DECR`，是原子操作。

### List

```bash
RPUSH queue:order "order1" "order2"
LPOP queue:order
BLPOP queue:order 5                # 阻塞式弹出，最多等 5 秒
LRANGE queue:order 0 -1            # 取全部
LTRIM queue:order 0 99             # 只保留前 100 个（固定长度列表）
```

`LPUSH + RPOP` 是队列，`LPUSH + LPOP` 是栈。`BLPOP` 可以实现简单的阻塞队列，但没有 ACK 机制，消费失败会丢消息。

### Hash

```bash
HSET user:1 name "张三" age 20
HGET user:1 name
HGETALL user:1
HINCRBY user:1 age 1
HDEL user:1 age
```

适合存对象，但**不要存超大 Hash**（比如百万用户的全部信息塞一个 key）——大 key 会阻塞主线程、迁移困难。按业务维度拆 key。

### Set

```bash
SADD tags:article:1 "java" "redis"
SISMEMBER tags:article:1 "java"    # O(1) 判断存在
SINTER tags:article:1 tags:article:2   # 交集（共同标签）
SUNIONSTORE result set1 set2           # 并集存到新 key
SPOP lottery 3                         # 随机弹出 3 个（抽奖）
```

### ZSet

```bash
ZADD rank 100 "user1" 200 "user2"
ZREVRANGE rank 0 9 WITHSCORES      # 排行榜前 10
ZINCRBY rank 10 "user1"            # 增加分数
ZRANGEBYSCORE rank 100 200         # 按分数范围
ZRANK rank "user1"                 # 正序排名
```

ZSet 是排行榜的标准答案，底层是跳表 + 字典（见 [24. Redis 跳表](/guide/t24)）。

## 二、四种扩展类型

| 类型 | 本质 | 命令 | 场景 |
| --- | --- | --- | --- |
| Bitmap | String 的位操作 | `SETBIT` `GETBIT` `BITCOUNT` `BITOP` | 签到、活跃用户统计、布隆过滤器 |
| HyperLogLog | 基数估算 | `PFADD` `PFCOUNT` `PFMERGE` | UV 统计（误差约 0.81%） |
| GEO | ZSet + 经纬度编码 | `GEOADD` `GEODIST` `GEOSEARCH` | 附近的人、门店距离 |
| Stream | 追加日志 + 消费组 | `XADD` `XREAD` `XGROUP` `XACK` | 消息队列（支持 ACK、消费组） |

### Bitmap

```bash
SETBIT sign:2024:11:09 1001 1      # 用户 1001 签到
GETBIT sign:2024:11:09 1001
BITCOUNT sign:2024:11:09           # 当天签到人数
BITOP AND result bitmap1 bitmap2   # 连续签到（与运算）
```

一个 bit 表示一个用户，1 亿用户也只要 12.5MB。适合“布尔状态 + 大量用户”的统计。

### HyperLogLog

```bash
PFADD uv:2024-11-09 user1 user2 user3
PFCOUNT uv:2024-11-09
PFMERGE uv:week uv:11-08 uv:11-09
```

固定 12KB 内存，标准误差 0.81%。**只能估算基数，不能取回元素**，适合 UV 这类“只要数量”的场景。

### GEO

```bash
GEOADD shops 116.40 39.90 "shop1"
GEODIST shops shop1 shop2 km
GEOSEARCH shops FROMMEMBER shop1 BYRADIUS 5 km ASC
```

底层是 ZSet，score 是经纬度编码后的 52 位整数，所以也支持 `ZREM` 等命令。

### Stream

```bash
XADD orders * userId 1 amount 100     # * 由 Redis 生成 ID
XGROUP CREATE orders g1 0             # 创建消费组
XREADGROUP GROUP g1 consumer1 COUNT 10 STREAMS orders >
XACK orders g1 <id>                   # 确认消费
```

Stream 有消费组、ACK、pending 列表，比 List 更接近真正的消息队列。但吞吐和可靠性仍不如专业 MQ。

## 三、底层编码

Redis 会根据数据大小自动切换编码，用 `OBJECT ENCODING key` 查看：

| 类型 | 编码 | 切换条件 |
| --- | --- | --- |
| String | `int` / `embstr` / `raw` | 整数用 int；≤44 字节用 embstr；否则 raw |
| List | `listpack` / `quicklist` | 元素 ≤128 且每个 ≤64 字节用 listpack，否则 quicklist（多个 listpack 组成的双向链表） |
| Hash | `listpack` / `hashtable` | 字段 ≤128 且值 ≤64 字节用 listpack |
| Set | `intset` / `listpack` / `hashtable` | 全是整数且 ≤512 个用 intset；小集合用 listpack；否则 hashtable |
| ZSet | `listpack` / `skiplist` | 元素 ≤128 且 ≤64 字节用 listpack；否则 skiplist + dict |
| Stream | `stream` | 固定 |

编码的意义：

- **listpack/ziplist**：连续内存，省空间、缓存友好，但插入删除要移动内存，只适合小数据；
- **quicklist**：把多个 listpack 串成链表，兼顾空间和插入性能；
- **hashtable/skiplist**：大数据量下的 O(1)/O(log n) 操作。

阈值可调（`*-max-listpack-entries`、`*-max-listpack-value`），但一般不建议改。

## 四、Key 的设计

```bash
# 推荐：业务:对象:ID:字段
user:1001:profile
order:20241109:10086
rank:game:2024-11-09

# 不推荐
u1001            # 无法按业务扫描
1001             # 语义不明
user_1001_name   # 层级混乱
```

| 原则 | 说明 |
| --- | --- |
| 可读 | 看到 key 知道是什么业务 |
| 有层级 | 用 `:` 分隔，方便 `SCAN` 按前缀匹配 |
| 控制长度 | key 也是内存，过长浪费 |
| 避免大 key | 单个 String ≤10KB、集合元素 ≤5000（经验值） |
| 设置 TTL | 缓存类 key 必须有过期时间 |

**大 key 的危害**：删除/读取时阻塞主线程、网络传输抖动、集群迁移卡顿。用 `redis-cli --bigkeys` 排查。

## 五、单线程为什么还快

Redis 6.0 之前命令执行是单线程的，快的原因：

1. **纯内存操作**，没有磁盘 IO；
2. **避免锁竞争和线程切换**；
3. **IO 多路复用**（epoll）处理大量连接；
4. **高效的数据结构**（跳表、listpack、渐进式 rehash）。

Redis 6.0 引入**多线程 IO**，只用于网络读写（解析命令、写回响应），**命令执行仍然是单线程**。所以“Redis 单线程”这个说法要分版本：6.0+ 是“多线程 IO + 单线程命令执行”。

::: danger
单线程的代价：一个慢命令（`KEYS *`、大 key 删除、`FLUSHALL`）会阻塞所有请求。线上禁用 `KEYS`，用 `SCAN` 渐进遍历；大 key 用 `UNLINK` 异步删除。

:::

## 六、面试连环问

**Q：Redis 有哪些数据类型？**

五种基础：String、List、Hash、Set、ZSet；四种扩展：Bitmap、HyperLogLog、GEO、Stream。回答时最好带一个使用场景，而不是只背名字。

**Q：ZSet 底层是什么？**

元素少且短时用 listpack，超过阈值用 skiplist + dict。跳表负责按 score 排序和范围查询，字典负责 member → score 的 O(1) 查询。

**Q：Hash 和 String 存对象怎么选？**

需要单独读写/修改某个字段用 Hash；整体读写、或者对象很小用 String（JSON 序列化）。Hash 字段多时注意大 key。

**Q：HyperLogLog 的误差和内存？**

固定 12KB，标准误差 0.81%。只支持计数估算，不支持取回元素，适合 UV 统计。

**Q：Bitmap 能存多少用户？**

按 offset 算，最大 offset 是 2^32-1（512MB），理论上限很大；实际按业务用户 ID 映射到连续 offset，1 亿用户约 12.5MB。

**Q：Redis 单线程还是多线程？**

::: info
6.0 之前完全单线程；6.0+ 网络 IO 多线程，命令执行仍单线程。所以不会出现并发写同一 key 的竞态，但慢命令依然会阻塞。

:::

**Q：为什么禁用 `KEYS *`？**

它会遍历所有 key，时间复杂度 O(n)，key 多时阻塞主线程数秒。用 `SCAN cursor MATCH pattern COUNT 100` 渐进遍历。

**Q：大 key 怎么处理？**

拆分（按业务维度拆成多个小 key）、压缩、用 `UNLINK` 异步删除、用 `HSCAN`/`SSCAN` 分批读。定期用 `--bigkeys` 排查。

## 七、自测清单

- [ ] 能说出九种类型及各自至少一个场景
- [ ] 能写出五种基础类型的常用命令
- [ ] 能说出 String 的三种编码和切换条件
- [ ] 能说出 Hash/ZSet 的 listpack 阈值
- [ ] 知道 Set 的 intset 适用条件
- [ ] 能解释 Bitmap、HyperLogLog、GEO 的底层和适用场景
- [ ] 能设计规范的 key 命名
- [ ] 能说出大 key 的危害和处理方式
- [ ] 能解释 Redis 6.0 多线程 IO 与单线程命令执行

## 延伸阅读

- [Redis 官方文档：Data types](https://redis.io/docs/data-types/)
- [24. Redis 跳表](/guide/t24)
- [25. Redis 过期策略](/guide/t25)
- [Redis 事务机制](/guide/redis-tx)
