# Redis 数据结构与常用命令

## Q：说说Redis数据结构和常用命令？

Redis是key-value数据库，key的类型只能是String，但是value的数据类型就比较丰富了，主要包括五种：

* String
* Hash
* List
* Set
* Sorted Set

### 1.  String字符串

**语法**

```plain
SET KEY_NAME VALUE
```
string类型是二进制安全的。意思是redis的string可以包含任何数据。比如jpg图片或者序列化的对象。
string类型是Redis最基本的数据类型，一个键最大能存储512MB。

### 2. Hash哈希

**语法**

```plain
HSET KEY_NAME FIELD VALUE
```
Redis hash 是一个键值(key=&gt;value)对集合。
Redis hash是一个string类型的field和value的映射表，hash特别适合用于存储对象。

### 3. List列表

**语法**

```plain
//在 key 对应 list 的头部添加字符串元素
LPUSH KEY_NAME VALUE1.. VALUEN
//在 key 对应 list 的尾部添加字符串元素
RPUSH KEY_NAME VALUE1..VALUEN
//对应 list 中删除 count 个和 value 相同的元素
LREM KEY_NAME COUNT VALUE
//返回 key 对应 list 的长度
LLEN KEY_NAME 
```
Redis 列表是简单的字符串列表，按照插入顺序排序。
可以添加一个元素到列表的头部（左边）或者尾部（右边）

### 4. Set集合

**语法**

```plain
SADD KEY_NAME VALUE1...VALUEn
```
Redis的Set是string类型的无序集合。
集合是通过哈希表实现的，所以添加，删除，查找的复杂度都是O(1)。

### 5. Sorted Set有序集合

**语法**

```plain
ZADD KEY_NAME SCORE1 VALUE1.. SCOREN VALUEN
```
Redis zset 和 set 一样也是string类型元素的集合,且不允许重复的成员。
不同的是每个元素都会关联一个double类型的分数。

redis正是通过分数来为集合中的成员进行从小到大的排序。

zset的成员是唯一的,但分数(score)却可以重复。

### 6. Redis常用命令参考

更多命令语法可以参考官网手册：

[https://www.redis.net.cn/order/](https://www.redis.net.cn/order/)

---完毕
