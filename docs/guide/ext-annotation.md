# Java 注解与自定义注解

## Q：说说Java 注解与自定义注解？

注解（Annotation）是 JDK 5 引入的**元数据**：它本身不含业务逻辑，只是一段可以挂在类、方法、字段、参数上的标记；真正让它“起作用”的是**解析它的代码**——编译期注解处理器，或者运行期通过反射读取注解的框架（Spring、MyBatis、JUnit）。

一个自定义注解由三部分组成：

| 部分 | 作用 | 例子 |
| --- | --- | --- |
| `@interface` 声明 | 定义注解类型 | `public @interface EnableRedisLock` |
| 注解属性 | 携带参数，只能是基本类型、String、Class、枚举、注解或其数组 | `long expireTime() default 10` |
| 元注解 | 描述注解本身：用在哪、保留到什么时候、是否进文档、是否可继承 | `@Target`、`@Retention`、`@Documented`、`@Inherited` |

下面用一个“Redis 分布式锁注解”把三步走完：定义注解 → 写切面解析 → 在业务方法上使用。

## 原来注解不神秘

注解用大白话来说就是一个标记或者说是特殊的注释，如果没有解析这些标记的操作那它啥也不是。

注解的格式如同类或者方法一样有自己特殊的语法，这个语法下文会详细介绍。

那如何去解析注解呢？这就要用到Java强大的反射功能了。反射大家应该都用过，可以通过类对象获取到这个类的各种信息比如成员变量、方法等，那注解标记能不能通过反射获取呢？当然可以了。

所以注解的原理其实很简单，本质上是通过反射功能动态获取注解标记，然后按照不同的注解执行不同的操作，比如@Autowired可以注入一个对象给变量赋值。

看到这里是不是很躁动啊，来吧自己也撸一个注解。

## 造火箭啦，自己动手写一个注解

便于大家理解，这里先引入一个场景：在线教育火了，经理让我写一个模块实现学生信息管理功能，考虑到分布式并发问题，经理让我务必加上分布式锁。

经理问我几天能搞定？我说至少3天。如是脑补了以下代码：

```java
/**
 * 更新学生信息
 * @param student 学生对象
 * @return true 更新成功，false 更新失败
 */
public boolean updateStudentInfo(Student student) {
    // 尝试获取分布式锁
    String lockKey = "student:" + student.getId();
    if (RedisTool.tryLock(lockKey, 10,
            TimeUnit.SECONDS, 5)) {
        try {
            // 这里写业务逻辑
        } finally {
            RedisTool.releaseLock(lockKey);
        }
    }
    // 获取锁失败
    return false;
}
```

经理走后我在思考，我能不能只花一天时间写完，剩下两天时间用来写博客划水呢？突然灵感来了，我可以把重复的代码逻辑抽出来用注解实现不就节省代码了，哈哈，赶紧写。

使用注解之后整个方法清爽了很多，HR小姐姐都夸我写的好呢。
```java
@EnableRedisLock(lockKey = "student", expireTime = 10, timeUnit = TimeUnit.SECONDS, retryTimes = 5)
public boolean updateStudentInfo(Student student) {
    // 这里写业务逻辑
    // studentDao.update(student);
    return true;
}
```

代码已经写完上库了，现在我在划水写博客呢。是不是很简洁很优雅很牛逼，怎么做到的呢，主要分为三步：1打开冰箱门，2把大象放进去，3把冰箱门关好。好了，扯远了，大家接着往下看。

### 第一步定义一个注解

一个注解可以简单拆解为三个部分：

第一部分：注解体

注解的定义有点类似于接口（interface），只不过前面一个加了一个@符号，这个千万不能省。

第二部分：注解变量

注解变量的语法有点类似于接口里面定义的方法，变量名后面带一对括号，不同的是注解变量后面可以有默认值。另外返回值只能是Java基本类型、String类型或者枚举类，不可以是对象类型。

第三部分：元注解

元注解（meta-annotation）说白了就是给注解加注解的注解，是不是有点晕了，这种注解是JDK提前内置好的，可以直接拿来用的。不太懂也没有关系反正数量也不多，总共就4个，我们背下来吧：@Target @Retention @Documented @Inherited

* Target注解

用来描述注解的使用范围，即被修饰的注解可以用在什么地方 。

注解可以用于修饰 packages、types（类、接口、枚举、注解类）、类成员（方法、构造方法、成员变量、枚举值）、方法参数和本地变量（如循环变量、catch参数），在定义注解类时使用了@Target 能够更加清晰的知道它能够被用来修饰哪些对象，具体的取值范围定义在ElementType.java 枚举类中。

比如上面我们写的Redis锁的注解就只能用于方法上了。

* Retention注解

用来描述注解保留的时间范围，即注解的生命周期。在 RetentionPolicy 枚举类中定义了三个周期：

```java
public enum RetentionPolicy {
    SOURCE, // 源文件保留
    CLASS,  // 编译期保留，默认值
    RUNTIME // 运行期保留，可通过反射去获取注解信息
}
```
像我们熟知的@Override注解就只能保留在源文件中，代码编译后注解就消失了。
比如上面我们写的Redis锁的注解就保留到了运行期，运行的时候可以通过反射获取信息。

* Documented注解

用来描述在使用 javadoc 工具为类生成帮助文档时是否要保留其注解信息，很简单不多解释了。

* Inherited注解

被Inherited注解修饰的注解具有继承性，如果父类使用了被@Inherited修饰的注解，则其子类将自动继承该注解。

好了，这一步我们已经将注解定义好了，但是这个注解如何工作呢？接着看。

### 第二步实现注解的业务逻辑

在第一步中我们发现定义的注解（@EnableRedisLock）中没有业务逻辑，只有一些变量，别忘了我们的注解是要使能Redis分布式锁的功能，那这个注解到底是怎么实现加锁和释放锁的功能呢？这个就需要我们借助反射的强大功能了。
```java
@Aspect
@Component
public class RedisLockAspect {

    @Around(value = "@annotation(enableRedisLock)")
    public Object handleRedisLock(ProceedingJoinPoint joinPoint,
                                  EnableRedisLock enableRedisLock) throws Throwable {
        // 环绕通知必须返回 Object，并把业务方法的返回值透传出去
        String lockKey = enableRedisLock.lockKey();
        long expireTime = enableRedisLock.expireTime();
        TimeUnit timeUnit = enableRedisLock.timeUnit();
        int retryTimes = enableRedisLock.retryTimes();

        String token = UUID.randomUUID().toString();
        if (!tryLock(lockKey, token, expireTime, timeUnit, retryTimes)) {
            throw new IllegalStateException("获取锁失败: " + lockKey);
        }
        try {
            return joinPoint.proceed();
        } finally {
            releaseLock(lockKey, token);   // Lua 比对 token 再删除
        }
    }
}
```

这里有两个容易写错的地方：

::: danger
1. **`@Around` 方法的返回值必须是 `Object`**，并且要 `return joinPoint.proceed()`。写成 `void` 会把业务方法的返回值吞掉，调用方拿到 null。
2. **释放锁要传 key 和 token**，不能无参 `releaseLock()`；删除前用 Lua 校验 token，避免超时后误删别人的锁。

:::

把注解参数直接声明成方法参数（`EnableRedisLock enableRedisLock`）是 Spring AOP 支持的写法，比手动反射 `getAnnotation` 更简洁。

### 第三步在业务代码中尽情的使用注解

```java
@EnableRedisLock(lockKey = "'student:' + #student.id", expireTime = 10,
                 timeUnit = TimeUnit.SECONDS, retryTimes = 5)
public void method1(Student student) {
    // 这里写业务逻辑
}
```

注意 `#student.id` 是 **SpEL 表达式**，需要切面里用 `SpelExpressionParser` 解析参数值，否则 `lockKey` 会按字面量处理，所有请求都抢同一把锁。简单的做法是先写死 key 做 demo，生产环境一定要按业务维度生成（订单号、用户 ID）。

注解只是“元数据 + 切面逻辑”，真正干活的是切面。理解这一点，自定义注解就不再神秘了。
