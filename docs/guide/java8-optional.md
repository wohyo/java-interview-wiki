# Optional 与空指针

> Optional 是 Java 8 引入的容器类，用来显式表达“这个值可能不存在”，从而减少空指针判断。
>
> 它不是银弹：适合做方法返回值，不适合做字段类型和参数；过度使用反而会让代码更难读。

## 1. 不受待见的空指针异常

有个小故事：null引用最早是由英国科学家Tony Hoare提出的，多年后Hoare为自己的这个想法感到后悔莫及，并认为这是"价值百万的重大失误"。可见空指针是多么不受待见。

NullPointerException是Java开发中最常遇见的异常，遇到这种异常我们通常的解决方法是在调用的地方加一个if判空。

if判空越多会造成过多的代码分支，后续代码维护也就越来越复杂。

## 2. 糟糕的代码

比如下面这个例子，用了过多的 if 判空。

Person对象里定义了House对象，House对象里定义了Address对象：

```java
public class Person {
    private String name;
    private int age;
    private House house;
    public House getHouse() {
        return house;
    }
}
class House {
    private long price;
    private Address address;
    public Address getAddress() {
        return address;
    }
}
class Address {
    private String country;
    private String city;
    public String getCity() {
        return city;
    }
}
```
现在获取这个人买房的城市，那么通常会这样写：
```java
public String getCity() {
    String city = new Person().getHouse().getAddress().getCity();
    return city;
}
```
但是这样写容易出现空指针的问题，比如这个人没有房，House对象为null。接着你会改造这段代码，加上很多判断条件：
```java
public String getCity2(Person person) {
    if (person != null) {
        House house = person.getHouse();
        if (house != null) {
            Address address = house.getAddress();
            if (address != null) {
                String city = address.getCity();
                return city;
            }
        }
    }
    return "unknown";
}
```
为了避免空指针异常，每一层都加上判断，但是这样会造成代码嵌套太深，不易维护。
你可能想到如何改造上面的代码，比如加上提前判空退出：

```java
public String getCity3(Person person) {
    String city = "unknown";
    if (person == null) {
      return city; 
    }
    House house = person.getHouse();
    if (house == null) {
        return city;
    }
    Address address = house.getAddress();
    if (address == null) {
        return city;
    }
    return address.getCity();
}
```
但是这样简单的代码已经加入了三个退出条件，非常不利于后面代码维护。那怎样才能将代码写的优雅一点呢，下面引入今天的主角"Optional"。
## 3. 解决空指针的"银弹"

从 Java8 开始引入了一个新类 java.util.Optional，这是一个对象的容器，意味着可能包含或者没有包含一个非空的值。下面重点看一下Optional的常用方法：

```java
public final class Optional<T> {
    // 通过指定非空值创建Optional对象
    // 如果指定的值为null，会抛空指针异常
    public static <T> Optional<T> of(T value) {
        return new Optional<>(value);
    }
    // 通过指定可能为空的值创建Optional对象
    public static <T> Optional<T> ofNullable(T value) {
        return value == null ? empty() : of(value);
    }
    // 返回值，不存在抛异常
    public T get() {
        if (value == null) {
            throw new NoSuchElementException("No value present");
        }
        return value;
    }
    // 如果值存在，根据consumer实现类消费该值
    public void ifPresent(Consumer<? super T> consumer) {
        if (value != null)
            consumer.accept(value);
    }
    // 如果值存在则返回，如果值为空则返回指定的默认值
    public T orElse(T other) {
        return value != null ? value : other;
    }
    // map flatmap等方法与Stream使用方法类似，这里不再赘述，读者可以参考之前的Stream系列。
}
```
以上就是Optional类常用的方法，使用起来非常简单。
## 4. Optional使用入门

**（1）创建 Optional 实例**

| 方法 | 入参 | 空值行为 |
| --- | --- | --- |
| `Optional.empty()` | 无 | 创建一个空 Optional |
| `Optional.of(value)` | 必须非 null | 传 null 直接抛 `NullPointerException` |
| `Optional.ofNullable(value)` | 可以为 null | null 返回 `Optional.empty()` |

```java
// 空对象
Optional<Person> empty = Optional.empty();

// 确定非空
Person person = new Person();
Optional<Person> nonNull = Optional.of(person);

// 可能为空（最常用）
Person maybeNull = null;
Optional<Person> nullable = Optional.ofNullable(maybeNull);
```

记忆：**不确定是否为空就用 `ofNullable`**；`of` 是“我保证非空”的断言，用错会直接 NPE，反而违背了 Optional 的初衷。
**（2）常用方法**
**ifPresent**

如果值存在，则调用consumer实例消费该值，否则什么都不执行。举个栗子：

```java
String str = "hello java8";
// output: hello java8
Optional.ofNullable(str).ifPresent(System.out::println);
String str2 = null;
// output: nothing
Optional.ofNullable(str2).ifPresent(System.out::println);
```
**filter, map, flatMap**
这三个方法在前面讲 Stream 的时候已经详细讲解过，读者可以翻看之前写的文章，这里不再赘述。

**orElse**

如果value为空，则返回默认值，举个栗子：

```java
public void test(String city) {
    String defaultCity = Optional.ofNullable(city).orElse("unknown");
}
```
**orElseGet**
如果value为空，则调用Supplier实例返回一个默认值。举个例子：

```java
public void test2(String city) {
    // 如果city为空，则调用generateDefaultCity方法
    String defaultCity = Optional.ofNullable(city).orElseGet(this::generateDefaultCity);
}
private String generateDefaultCity() {
    return "beijing";
}
```
**orElseThrow**
如果value为空，则抛出自定义异常。举个栗子：

```java
public void test3(String city) {
    // 如果city为空，则抛出空指针异常。
    String defaultCity = Optional.ofNullable(city).orElseThrow(NullPointerException::new);
}
```
## Q：如何使用Optional重构代码？

**再看一遍重构之前的代码，使用了三个if使代码嵌套层次变得很深。**

```java
// before refactor
public String getCity2(Person person) {
    if (person != null) {
        House house = person.getHouse();
        if (house != null) {
            Address address = house.getAddress();
            if (address != null) {
                String city = address.getCity();
                return city;
            }
        }
    }
    return "unknown";
}
```
**使用Optional重构**
```java
public String getCityUsingOptional(Person person) {
    String city = Optional.ofNullable(person)
            .map(Person::getHouse)
            .map(House::getAddress)
            .map(Address::getCity).orElse("Unknown city");
    return city;
}
```
只使用了一行代码就获取到city值，不用再去不断的判断是否为空，这样写代码是不是很优雅呀。
## 总结
使用 Optional 可以更优雅地处理空值，但它不是万能的：它是**方法返回值**的语义表达，不适合做字段类型、方法参数，也不该用来替代所有 if 判断。过度使用只会让代码更难读。
