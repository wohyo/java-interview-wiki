# Java 8 函数式接口与 Lambda

## Q：说说Java 8 函数式接口与 Lambda？

&gt;Java8 由Oracle在2014年发布，是继Java5之后最具革命性的版本了。
&gt;Java8吸收其他语言的精髓带来了函数式编程，lambda表达式，Stream流等一系列新特性，学会了这些新特性，可以让你实现高效编码优雅编码。
## 1. Lambda表达式小试牛刀

Lambada表达式可以理解为：可传递的匿名函数的一种简洁表达方式。Lambda表达式没有名称，同普通方法一样有参数列表、函数主体、返回类型等；

下面简单看一个例子，new一个线程打印字符串，采用lambda表达式非常简洁：

```java
new Thread(() -> System.out.println("hello java8 lambda")).start()
```

Thread类接受一个Runnable类型实例，查看Jdk源码发现Runnable接口是一个函数式接口，可以直接用lambda表达式替代。

```java
@FunctionalInterface
public interface Runnable {
    public abstract void run();
}
```

Lambda表达式语法非常简单：

```java
() -> System.out.println("hello java8 lambda")
```

* ()括号里面是参数列表，如果只有一个参数还可以写为： a -&gt; System.out.println(a)
* -&gt; 箭头为固定写法；
* System.out.println("hello java8 lambda") 为函数主体，如果有多条语句要用花括号包裹起来, 比如下面这样：
```java
(a, b) -> {int sum = a + b; return sum;}
```

综上，Lambda表达式模块可以固化为：

```java
(parameter) -> {expression} 或者 (parameter) -> {statements; statements; }
```

参数只有一个可以省略括号

如果不用Lambda表达式，使用匿名内部类的方式，写法就不是那么优雅了。

```java
// before Java8
new Thread(new Runnable() {
    @Override
    public void run() {
        System.out.println("hello java8 without lambda");
    }
}).start();
```

## 2. Lambda高阶用法

### （1）函数式接口

函数式接口是只定义了一个抽象方法的接口。注意Java8中允许存在默认方法（default），哪怕有很多默认方法，只要有且仅有一个抽象方法，那么这个接口仍然是函数式接口。

函数式接口通常在类上有一个注解@FunctionalInterface，如：

```java
@FunctionalInterface
public interface Runnable {
    public abstract void run();
}
```

### （2）函数式接口可以干什么？

通常lambda表达式与函数式接口结合一起用，lambda表达式以内联的形式为函数式接口的抽象方法提供实现，把整个表达式作为函数式接口的实例。在没有lambda表达式之前，我们通常会使用匿名内部类的方式实现，详细对比见第一小节的实例代码。

### （3）函数描述符

函数式接口抽象方法的签名基本上就是lambda表达式的签名，我们可以将这种对应关系称为函数描述符。由一个函数式接口的抽象方法抽象为一个函数描述符，这个过程非常重要，知道了函数描述符去写lambda表达式也就非常容易了。举个例子：

Runnable接口有一个抽象方法 void run(), 接受空参数返回void，那么函数描述符可以推导为： () -&gt; void

lambda表达式可以写为 () -&gt; System.out.println("hello java8 lambda")

### （4）常用函数式接口

java8 中常用函数式接口，针对基本类型java还定义了IntPredicate, LongPredicate等类型，详细可以参考jdk源码。

|函数式接口|函数描述符|
|:----|:----|
|Predicate&lt;T&gt;|T-&gt;boolean|
|Consumer&lt;T&gt;|T-&gt;void|
|Function&lt;T,R&gt;|T-&gt;R|
|Supplier&lt;T&gt;|() -&gt; T|
|UnaryOperator&lt;T&gt;|T -&gt; T|
|BinaryOperator&lt;T&gt;|(T,T)-&gt;T|
|BiPredicate&lt;L,R&gt;|(L,R)-&gt;boolean|
|BiConsumer&lt;T,U&gt;|(T,U)-&gt;void|
|BiFunction&lt;T,U,R&gt;|(T,U)-&gt;R|

至于 Predicate, Consumer, Function这些函数式接口具体作用，在后面的文章中笔者会详细介绍，这里只需有个大体印象即可。

### （5）将lambda表达式重构为方法引用

方法引用可以看作是lambda表达式的一种快捷写法，它可以调用特性的方法作为参数传递。你也可以将方法引用看作是lambda表达式的语法糖，让lambda表达式写起来更加简介。举个栗子，按学生年龄排序：

```java
// before
students.sort((s1, s2) -> s1.getAge.compareTo(s2.getAge()))));
// after 使用方法引用
students.sort(Comparator.comparing(Student::getAge()))));
```

方法引用主要有三类：

* **静态方法的方法引用**

valueOf是String类的静态方法，方法引用写为 String::valueOf, 对应lambda表达式：a -&gt; String.valueOf(a)

* **任意类型实例方法的方法引用**

length是String类的实例方法，方法引用写为 String::length，对应lambda表达式： (str) -&gt; str.length()

* **现有对象的实例方法的方法引用**

第三种容易与第二种混淆，现有对象指的是在lambda表达式中调用外部对象（不是入参对象）的实例方法，比如：

String str = "hello java8";

() -&gt; str.length();

对应方法引用写为 str::length, 注意不是 String::length

最后我们将三类方法引用归纳如下：

|lambda表达式|方法引用|    |
|:----|:----|:----|
|(args) -&gt; ClassName.staticMethod(args)|ClassName::staticMethod|静态方法方法引用|
|(arg0, params) -&gt; arg0.instanceMethod(params)|ClassName::instanceMethod|内部实例方法引用|
|arg0<br>(params) -&gt; arg0.instanceMethod(params)|arg0.instanceMethod|外部实例方法引用|
