# CountDownLatch 倒计时计数器

**一句话定位**：`CountDownLatch` 让一个（或多个）线程等待另外 N 个线程完成任务——计数器初始为 N，每个线程完成后 `countDown()`，减到 0 时所有 `await()` 的线程被唤醒。

## 认识 CountDownLatch

`CountDownLatch`是一个同步工具类，用来协调多个线程之间的同步，或者说起到线程之间通信的作用（非互斥）。

CountDownLatch 能够使一个线程在等待另外一些线程完成各自工作之后，再继续执行。使用一个计数器进行实现。计数器初始值为线程的数量。当每一个线程完成自己任务后，计数器的值就会减一。当计数器的值为0时，表示所有的线程都已经完成一些任务，然后在CountDownLatch上等待的线程就可以恢复执行接下来的任务。

## Q：说说CountDownLatch 的使用？

CountDownLatch类使用起来非常简单。

Class 位于：`java.util.concurrent.CountDownLatch`

下面简单介绍它的构造方法和常用方法。

### 构造方法

CountDownLatch只提供了一个构造方法：

```java
// count 为初始计数值
public CountDownLatch(int count) {
  // ……
}
```

### 常用方法

```java
//常用方法1：调用await()方法的线程会被挂起，它会等待直到count值为0才继续执行
public void await() throws InterruptedException {
  // ……
}   

// 常用方法2：和await()类似，只不过等待超时后count值还没变为0的话就会继续执行
public boolean await(long timeout, TimeUnit unit) throws InterruptedException { 
  // ……
}

// 常用方法3：将count值减1
public void countDown() {
  // ……
}  
```

## Q：说说CountDownLatch 的应用场景？

我们考虑一个场景：用户购买一个商品下单成功后，我们会给用户发送各种消息提示用户『购买成功』，比如发送邮件、微信消息、短信等。所有的消息都发送成功后，我们在后台记录一条消息表示成功。

当然我们可以使用单线程去完成，逐个完成每个操作，如下图所示：

但是这样效率就会非常低。如何解决单线程效率低的问题？当然是通过多线程啦。

使用多线程也会遇到一个问题，子线程消息还没发送完，主线程可能就已经打出『所有的消息都已经发送完毕啦』，这在逻辑上肯定是不对的。我们期望所有子线程发完消息主线程才会打印消息，怎么实现呢？CountDownLatch就可以解决这一类问题。

我们使用代码实现上面的需求。

```java
import java.util.concurrent.*;

public class OrderServiceDemo {

    public static void main(String[] args) throws InterruptedException {
        System.out.println("main thread: Success to place an order");

        int count = 3;
        CountDownLatch countDownLatch = new CountDownLatch(count);

        Executor executor = Executors.newFixedThreadPool(count);
        executor.execute(new MessageTask("email", countDownLatch));
        executor.execute(new MessageTask("wechat", countDownLatch));
        executor.execute(new MessageTask("sms", countDownLatch));

        // 主线程阻塞，等待所有子线程发完消息
        countDownLatch.await();
        // 所有子线程已经发完消息，计数器为0，主线程恢复
        System.out.println("main thread: all message has been sent");
    }

    static class MessageTask implements Runnable {
        private String messageName;
        private CountDownLatch countDownLatch;

        public MessageTask(String messageName, CountDownLatch countDownLatch) {
            this.messageName = messageName;
            this.countDownLatch = countDownLatch;
        }

        @Override
        public void run() {
            try {
                // 线程发送消息
                System.out.println("Send " + messageName);
                try {
                    TimeUnit.SECONDS.sleep(1);
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
            } finally {
                // 发完消息计数器减 1
                countDownLatch.countDown();
            }
        }
    }
}
```

程序运行结果：

```text
main thread: Success to place an order
Send email
Send wechat
Send sms
main thread: all message has been sent
```

从运行结果可以看到主线程是在所有的子线程发送完消息后才打印，这符合我们的预期。

## Q：说说CountDownLatch 的限制？

### 1. 一次性

`CountDownLatch` 是一次性的：计数器的值只能在构造方法中初始化一次，减到 0 后没有任何机制重置。**用完即废**，要复用只能新建一个实例。

这也是它和 `CyclicBarrier` 最本质的区别。

### 2. 底层是 AQS 共享模式

`CountDownLatch` 内部有一个 `Sync extends AbstractQueuedSynchronizer`：

- `state` 就是计数器；
- `countDown()` → `releaseShared(1)`，CAS 把 state 减 1，减到 0 时唤醒所有共享节点；
- `await()` → `acquireSharedInterruptibly(1)`，state 不为 0 就入队 park。

```java
// 简化后的 Sync
protected int tryAcquireShared(int acquires) {
    return (getState() == 0) ? 1 : -1;      // state 为 0 才算获取成功
}

protected boolean tryReleaseShared(int releases) {
    for (;;) {
        int c = getState();
        if (c == 0) return false;
        int nextc = c - 1;
        if (compareAndSetState(c, nextc))
            return nextc == 0;               // 减到 0 时返回 true，唤醒后继
    }
}
```

还有一个常被忽略的语义：**`countDown()` 之前的操作，happens-before `await()` 返回之后的操作**。所以子线程写入的结果，主线程 `await()` 之后一定看得到——不需要额外的同步。

### 3. 不能循环使用：和 CyclicBarrier 的对比

```java
// CyclicBarrier：一组线程互相等待，到齐后一起继续，并且可以重复使用
CyclicBarrier barrier = new CyclicBarrier(3, () -> System.out.println("all arrived"));

for (int i = 0; i < 3; i++) {
    new Thread(() -> {
        try {
            System.out.println(Thread.currentThread().getName() + " arrived");
            barrier.await();               // 等另外两个线程
            System.out.println(Thread.currentThread().getName() + " continue");
        } catch (Exception e) {
            e.printStackTrace();
        }
    }).start();
}
```

| 维度 | CountDownLatch | CyclicBarrier |
| --- | --- | --- |
| 方向 | 一个/多个线程等 N 个线程完成 | N 个线程互相等待 |
| 复用 | ❌ 一次性 | ✅ 可循环（`reset()` 或自动重置） |
| 计数 | 减到 0 | 加到 parties |
| 底层 | AQS 共享模式 | `ReentrantLock` + `Condition` |
| 异常 | 不会“打破”，其他线程继续等 | 一个线程异常/超时，整个 barrier 被打破 |
| 典型场景 | 主线程等子任务全部完成 | 多阶段并行计算，每个阶段要同步 |

记忆：**CountDownLatch 是“等人齐了开会”，CyclicBarrier 是“人齐了出发，下一段再集合”。**
