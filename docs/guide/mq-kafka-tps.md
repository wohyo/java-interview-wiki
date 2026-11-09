# Kafka 百万级 TPS 的实现原理

**一句话定位**：Kafka 的高吞吐不是靠某一个“黑科技”，而是**顺序写 + 页缓存 + 零拷贝 + 批量 + 分区并行**五件事叠出来的；其中常被误传的“MMAP”其实只用在索引文件上。

## 一、先看结论

| 手段 | 解决什么 | 关键实现 |
| --- | --- | --- |
| 顺序追加写 | 避免随机 IO 的寻道开销 | 每个 Partition 一个追加日志，只在文件末尾写 |
| 页缓存（Page Cache） | 读写不直接落盘 | 写入先进 OS 页缓存，由内核刷盘；读命中缓存不读磁盘 |
| 零拷贝 | 减少内核态/用户态的数据复制 | `sendfile`（Java 的 `FileChannel.transferTo`） |
| 批量 + 压缩 | 减少系统调用和网络包数量 | `batch.size`、`linger.ms`、`compression.type` |
| 分区并行 | 突破单机单盘的吞吐上限 | Topic 分多个 Partition，分散到不同 Broker/磁盘 |
| 顺序消费 + offset | 消费端顺序读，避免随机访问 | 消费者按 offset 顺序拉取 |

## 二、顺序写：把随机 IO 变成顺序 IO

机械硬盘的一次随机读要经历**寻道 + 旋转延迟 + 传输**，前两项是毫秒级；顺序读省掉寻道和旋转，吞吐能差一到两个数量级。SSD 虽然没有机械寻道，但顺序写仍然更友好（减少写放大、减少 GC）。

Kafka 的日志结构：

```
topic-order-partition-0/
├── 00000000000000000000.log   ← 消息追加在文件末尾
├── 00000000000000000000.index ← 稀疏索引（offset → 物理位置）
└── 00000000000000000000.timeindex
```

每条消息追加到 `.log` 末尾，只做 append，不修改已有内容。删除旧数据也不是“改文件”，而是**按段（segment）整文件删除**——这也是 Kafka 敢把日志一直留着的底气。

> 注意：Kafka 的顺序写是“**分区内**顺序”。多个 Partition 之间仍然是并发的随机写，只是每个 Partition 各自顺序。分区数越多，磁盘上的并发写也越多。

## 三、页缓存：真正的“内存加速”

Kafka 写消息时**不直接写磁盘**，而是写到操作系统的 Page Cache，由内核根据脏页策略异步刷盘：

```
Producer → Kafka Broker → 写入 Page Cache → 内核异步 flush → 磁盘
Consumer ← 从 Page Cache 读（命中则完全不碰磁盘）← 磁盘
```

| 好处 | 说明 |
| --- | --- |
| 写快 | 写内存的速度，不需要等磁盘 |
| 读快 | 刚写入的数据大概率还在缓存里，消费者能直接命中 |
| 进程重启不丢缓存 | Page Cache 属于内核，Kafka 重启后缓存还在 |
| 内存管理交给 OS | 不需要 JVM 堆内缓存，避免 GC 压力 |

这也是 Kafka 建议**不要给 Broker 配超大 JVM 堆**的原因：堆越大，GC 停顿越长，而真正需要的内存是给 Page Cache 的。常见配置是堆 6~8GB，剩下的大部分内存留给操作系统。

## 四、MMAP 的真相

网上大量文章说“Kafka 用 MMAP 写日志”，这不准确。

| 文件 | 是否用 MMAP |
| --- | --- |
| `.log` 数据文件 | ❌ 用 `FileChannel.write` 顺序写 + Page Cache |
| `.index` / `.timeindex` 索引文件 | ✅ 用 `MappedByteBuffer` 映射，随机读索引项 |
| 消费者读日志 | 用 `FileChannel.transferTo`（sendfile 零拷贝） |

为什么数据文件不用 MMAP：

1. **可靠性**：MMAP 写入的脏页由 OS 决定何时刷盘，进程崩溃/断电时数据可能丢失，Kafka 需要自己控制刷盘节奏（`flush.messages`、`flush.ms`），用 `FileChannel` 更可控；
2. **零拷贝配合**：`sendfile` 需要数据在内核页缓存里，MMAP 映射到用户空间反而绕了一圈；
3. **页错误**：大文件映射后访问会触发缺页中断，延迟不可控。

索引文件小（默认 10MB 一个段）、需要随机读，用 MMAP 让读写像访问内存一样，是合适的。

## 五、零拷贝：从 4 次拷贝到 2 次

### 传统方式（read + write）

```
① DMA：磁盘 → 内核读缓冲区
② CPU：内核读缓冲区 → 用户缓冲区
③ CPU：用户缓冲区 → Socket 缓冲区
④ DMA：Socket 缓冲区 → 网卡
```

4 次拷贝、4 次上下文切换（用户态/内核态来回）。

### sendfile

```
① DMA：磁盘 → 内核读缓冲区（Page Cache）
② DMA：内核读缓冲区 → 网卡缓冲区（附带长度/偏移信息）
```

2 次拷贝、2 次上下文切换，**CPU 不参与数据搬运**。Java 里对应：

```java
// Kafka 内部用 FileRecords.transferTo 调用
fileChannel.transferTo(position, count, socketChannel);
```

Linux 2.4+ 的 `sendfile` 还支持 `gather` 模式，把多个文件片段直接组装发送，进一步减少拷贝。

> 零拷贝不是“一次都不拷贝”，而是**去掉 CPU 参与的用户态拷贝**。DMA 拷贝仍然存在，但 DMA 不占 CPU。

## 六、批量与压缩

### 生产端批量

```properties
batch.size=16384          # 每批最多 16KB
linger.ms=5               # 最多等 5ms 凑批
compression.type=lz4      # 压缩算法：none/gzip/snappy/lz4/zstd
buffer.memory=33554432    # 生产端缓冲池 32MB
```

- `batch.size` 越大，吞吐越高、延迟越大；
- `linger.ms` 给“凑批”留时间，0 表示不等待；
- 压缩在**批量**上做，压缩比远高于单条消息，网络传输和磁盘占用都下降。

### 消费端批量拉取

```properties
fetch.min.bytes=1          # 至少攒到 1 字节就返回（可调大以提高吞吐）
fetch.max.wait.ms=500      # 最多等 500ms
max.partition.fetch.bytes=1048576
```

一次 fetch 返回一批消息，减少网络往返。消费者按 offset 顺序消费，不需要随机访问。

### 关于“百万 TPS”的数字

“百万 TPS”是在**小消息（几十~几百字节）+ 多分区 + 批量 + 压缩 + 足够磁盘/网络**的条件下测出来的。同样 10MB/s 的带宽：

- 每条 100 字节 → 约 10 万条/秒；
- 每条 10 字节 → 约 100 万条/秒。

所以“百万 TPS”说的是**消息条数**，不是数据量。脱离消息大小谈 TPS 没有意义。

## 七、分区并行与副本

| 机制 | 作用 |
| --- | --- |
| 多 Partition | 一个 Topic 拆成多个分区，分散到不同 Broker，读写并行 |
| 多副本 | 每个 Partition 有 leader + follower，leader 读写、follower 同步 |
| ISR | 与 leader 保持同步的副本集合，`acks=all` 时要求 ISR 全部写入 |
| 消费者组 | 一个分区同一时刻只被组内一个消费者消费，组内并行 |

分区不是越多越好：分区太多会增加文件句柄、元数据、选举和 rebalance 成本。经验上单 Broker 的分区数控制在几千以内。

## 八、和其他 MQ 的对比

| 维度 | Kafka | RocketMQ | RabbitMQ |
| --- | --- | --- | --- |
| 设计目标 | 高吞吐日志流 | 高可靠业务消息 | 灵活路由、低延迟 |
| 存储 | 分区追加日志 | CommitLog + ConsumeQueue | 队列（内存/磁盘） |
| 吞吐 | 最高 | 高 | 中 |
| 延迟 | 毫秒~几十毫秒 | 毫秒 | 微秒~毫秒 |
| 事务消息 | 支持（较复杂） | 原生支持 | 不支持 |
| 延迟消息 | 不支持（需外部实现） | 支持多级别 | 支持（插件） |

选型不是“谁更快”，而是看场景：日志采集、流处理选 Kafka；业务消息、事务消息选 RocketMQ；路由复杂、量不大选 RabbitMQ。

## 九、面试连环问

**Q：Kafka 为什么快？**

顺序写避免随机 IO、页缓存减少磁盘访问、零拷贝减少数据复制、批量+压缩减少网络开销、分区并行突破单机瓶颈。五者叠加，不是单一原因。

**Q：Kafka 用了 MMAP 吗？**

数据日志**没有**用 MMAP，用的是 `FileChannel` 顺序写 + Page Cache；只有 `.index`/`.timeindex` 索引文件用 `MappedByteBuffer`。很多文章把“页缓存”误写成“MMAP”。

**Q：零拷贝是怎么实现的？**

`sendfile` 系统调用，数据从 Page Cache 直接 DMA 到网卡，省掉“内核 → 用户 → 内核”的两次 CPU 拷贝。Java 通过 `FileChannel.transferTo` 调用。

**Q：零拷贝有什么限制？**

数据不能经过用户空间，所以不能在用户态修改内容（比如加密、压缩要在写入前完成）；需要操作系统和文件系统支持。

**Q：Kafka 为什么不用 JVM 堆缓存？**

堆内缓存受 GC 影响，大堆会导致长停顿；Page Cache 由操作系统管理，容量更大、不受 GC 控制。Kafka 的堆通常只配 6~8GB。

**Q：批量大小怎么权衡？**

`batch.size` 和 `linger.ms` 越大，吞吐越高、延迟越大。实时性要求高就调小；离线/日志场景可以调大（如 64KB~1MB，linger 10~50ms）。

**Q：分区越多越好吗？**

不是。分区多能提高并行度，但会增加文件句柄、元数据、副本同步和 rebalance 成本，还会拉长故障恢复时间。按目标吞吐和消费者数量规划。

## 十、自测清单

- [ ] 能说出高吞吐的五个手段
- [ ] 能解释“分区内顺序写”的含义
- [ ] 能区分 Page Cache 与 MMAP，并说出 Kafka 各用在什么文件上
- [ ] 能画出传统 IO 与 sendfile 的拷贝次数对比
- [ ] 能说出 `batch.size`、`linger.ms`、`compression.type` 的作用
- [ ] 能解释为什么“百万 TPS”要结合消息大小看
- [ ] 能说出分区数与吞吐、延迟、rebalance 的关系
- [ ] 能对比 Kafka、RocketMQ、RabbitMQ 的适用场景

## 延伸阅读

- [Kafka 官方文档：Design](https://kafka.apache.org/documentation/#design)
- [Kafka 会不会丢消息](/guide/mq-kafka-loss)
- [19. 索引](/guide/t19)
