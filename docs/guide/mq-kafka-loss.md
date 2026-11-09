# Kafka 会不会丢消息

**一句话定位**：Kafka 默认配置下**会丢**；要做到不丢，生产端、Broker、消费端三段都得配对——`acks=all` + 副本同步 + 手动提交，缺一段就有一条缝。

## 一、先明确“消息语义”

| 语义 | 含义 | 实现代价 |
| --- | --- | --- |
| At most once | 最多一次，可能丢，不会重复 | 最低（发完就算，不重试） |
| At least once | 至少一次，不会丢，可能重复 | 中（重试 + 手动提交 + 幂等消费） |
| Exactly once | 恰好一次 | 最高（事务 / 幂等 + 事务读） |

大多数业务选择 **at least once + 消费端幂等**，而不是硬上 exactly once。

## 二、生产端丢失

消息从 Producer 到 Broker 的链路上，两个参数决定可靠性：

```properties
acks=all                  # 所有 ISR 副本都写入才返回成功
retries=2147483647        # 重试次数（配合 delivery.timeout.ms 控制总时长）
enable.idempotence=true   # 幂等生产者，防止重试导致重复
max.in.flight.requests.per.connection=5   # 幂等开启时最多 5，保证顺序
```

| `acks` | 含义 | 丢失风险 |
| --- | --- | --- |
| `0` | 发出去就不管 | 最高，Broker 没收到也不知道 |
| `1` | leader 写入成功即返回 | leader 写完但副本没同步时宕机 → 丢 |
| `all`（`-1`） | ISR 全部写入才返回 | 最低，配合 `min.insync.replicas` |

**Kafka 3.0 起**默认值变了：`acks=all`、`enable.idempotence=true`、`retries=Integer.MAX_VALUE`（KIP-679）。如果你的客户端还是 2.x，默认是 `acks=1`、幂等关闭，升级时要注意。

### 幂等生产者解决什么

网络超时后 Producer 会重试，Broker 可能已经写入成功——重试就重复了。幂等生产者给每条消息带 `<PID, epoch, sequence>`，Broker 按 sequence 去重，保证**单分区、单会话内**不重复。

注意：幂等只解决“重试导致的重复”，不解决“跨分区/跨会话”的 exactly once，那需要事务。

### 生产端还会怎么丢

| 场景 | 说明 |
| --- | --- |
| `acks=0` | 根本不确认 |
| 缓冲区满 + `block.on.buffer.full=false` | 新消息被丢弃（老版本参数，现用 `max.block.ms` 抛异常） |
| 重试耗尽 | `delivery.timeout.ms` 到期，消息被判定失败，业务没处理 |
| 序列化异常 | 消息根本没发出去 |

## 三、Broker 端丢失

Broker 的可靠性靠**副本**，不是靠刷盘：

```properties
replication.factor=3              # 每个分区 3 个副本
min.insync.replicas=2             # acks=all 时至少 2 个副本确认
unclean.leader.election.enable=false   # 禁止非 ISR 副本当 leader
```

| 配置 | 作用 |
| --- | --- |
| `replication.factor=3` | 容忍 1 个 Broker 挂掉 |
| `min.insync.replicas=2` | 保证写入至少落在 2 个副本上；只剩 1 个副本时写入直接失败（宁可不可用，也不丢） |
| `unclean.leader.election.enable=false` | 防止落后很多的副本被选为 leader，导致已提交消息被截断 |

三个参数的组合效果：

```
replication.factor=3, min.insync.replicas=2, acks=all
→ 写入必须落在 leader + 至少 1 个 follower
→ 挂 1 个 Broker 仍可写；挂 2 个则拒绝写入（不丢，但不可用）
```

### 关于刷盘

Kafka **不依赖 `fsync`** 保证可靠，而是依赖多副本。消息写入 Page Cache 就返回，由副本同步提供冗余；即使 leader 宕机，follower 上还有。`log.flush.interval.messages` / `log.flush.interval.ms` 默认很大，调小会严重降低吞吐，通常不建议改。

## 四、消费端丢失

这是最容易出问题的一段。

### 自动提交的坑

```properties
enable.auto.commit=true
auto.commit.interval.ms=5000
```

自动提交是**按时间**提交 offset，不是“处理完才提交”：

```
poll 一批消息 → 处理了 3 条（共 10 条）→ 到了 5 秒，自动提交 offset=10
→ 消费者崩溃 → 重启从 offset=10 开始 → 剩下 7 条丢了
```

### 正确姿势：手动提交

```properties
enable.auto.commit=false
```

```java
while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(500));
    for (ConsumerRecord<String, String> record : records) {
        process(record);                 // 先处理
    }
    consumer.commitSync();               // 处理完再提交
}
```

顺序很重要：

| 顺序 | 结果 |
| --- | --- |
| 先提交，后处理 | 处理失败时 offset 已提交 → **丢消息** |
| 先处理，后提交 | 提交失败/重复消费 → **重复消息**（用幂等解决） |

### 多线程消费

`KafkaConsumer` 不是线程安全的。多线程方案：

1. 每个线程一个 Consumer（简单，但受分区数限制）；
2. 单 Consumer 拉取，丢给线程池处理，**处理完成后统一提交**（要自己维护 offset 水位）；
3. 用 Kafka Streams / Flink 托管。

线程池方案如果“提交 offset 早于处理完成”，依然会丢。

## 五、端到端 Exactly Once

Kafka 的事务 + 幂等可以做到“消费-处理-生产”的原子性：

```java
producer.initTransactions();
try {
    producer.beginTransaction();
    for (ConsumerRecord<String, String> record : records) {
        producer.send(new ProducerRecord<>("output", transform(record)));
    }
    producer.sendOffsetsToTransaction(offsets, consumerGroupId);
    producer.commitTransaction();
} catch (Exception e) {
    producer.abortTransaction();
}
```

消费端配置：

```properties
isolation.level=read_committed   # 只读已提交的事务消息
```

限制：只覆盖 Kafka 内部的读写，如果处理过程中调用了外部数据库/HTTP 接口，外部副作用不在事务里，仍要业务幂等或对账。

## 六、三段配置速查

| 阶段 | 必配 | 作用 |
| --- | --- | --- |
| 生产端 | `acks=all` | 等所有 ISR 确认 |
| 生产端 | `enable.idempotence=true` | 重试不重复 |
| 生产端 | `retries` 足够大 + `delivery.timeout.ms` 合理 | 给重试留时间 |
| Broker | `replication.factor>=3` | 多副本冗余 |
| Broker | `min.insync.replicas>=2` | 至少两个副本确认 |
| Broker | `unclean.leader.election.enable=false` | 不让落后副本当 leader |
| 消费端 | `enable.auto.commit=false` | 手动控制提交时机 |
| 消费端 | 处理成功后再 `commitSync` | 不丢 |
| 消费端 | 业务幂等（唯一键/去重表） | 不重复 |

## 七、常见追问

**Q：Kafka 会丢消息吗？**

默认配置下有可能。生产端 `acks=1` 时 leader 写完就返回；消费端自动提交可能“没处理就提交”。要保证不丢，三段都要配置。

**Q：`acks=all` 就万无一失了吗？**

不一定。还要 `min.insync.replicas>=2` 和 `unclean.leader.election.enable=false`。如果 ISR 只剩 leader 一个，`acks=all` 也只是一份；如果允许 unclean 选举，落后副本当 leader 会截断已提交消息。

**Q：Kafka 为什么不靠刷盘保证可靠？**

刷盘是随机 IO，会严重拖慢吞吐。Kafka 用多副本冗余代替单机持久化：消息写入 Page Cache 即返回，靠 follower 同步提供可靠性。单机断电可能丢缓存里的数据，但多副本还在。

**Q：消费端怎么保证不丢？**

关闭自动提交，处理完再提交 offset。先处理后提交会重复（用幂等解决），先提交后处理会丢。

**Q：重复消费怎么解决？**

业务幂等：唯一索引、去重表、状态机（只允许一次状态流转）、Redis `SETNX`。不要指望 Kafka 帮你做业务去重。

**Q：Kafka 3.0 的默认值有什么变化？**

生产端默认 `acks=all`、`enable.idempotence=true`、`retries=Integer.MAX_VALUE`，可靠性默认提高，但吞吐会略降。2.x 升级到 3.x 时要评估。

**Q：事务消息能保证 exactly once 吗？**

在 Kafka 内部（消费 → 处理 → 生产）可以；如果处理过程中有外部副作用（写数据库、调接口），那部分不在事务里，仍需要业务幂等。

## 八、自测清单

- [ ] 能说出三种消息语义及代价
- [ ] 能解释 `acks` 三个取值的丢失风险
- [ ] 知道 Kafka 3.0 生产端默认值的变化
- [ ] 能解释幂等生产者的 `<PID, epoch, sequence>` 机制
- [ ] 能说出 Broker 端三个关键参数及组合效果
- [ ] 能解释为什么 Kafka 不依赖 `fsync`
- [ ] 能画出自动提交导致丢消息的时间线
- [ ] 能说出“先处理后提交”和“先提交后处理”的后果
- [ ] 能描述 Kafka 事务的 exactly once 范围和限制

## 延伸阅读

- [Kafka 官方文档：Message Delivery Semantics](https://kafka.apache.org/documentation/#semantics)
- [KIP-679: Producer will enable the strongest delivery guarantees by default](https://cwiki.apache.org/confluence/display/KAFKA/KIP-679)
- [Kafka 百万级 TPS 的实现原理](/guide/mq-kafka-tps)
