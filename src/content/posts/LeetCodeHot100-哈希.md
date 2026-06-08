---
title: LeetCode Hot 100 - 哈希
description: 包含两数之和、字母异位词分组、最长连续序列三道题。
tags:
  - Algorithm
createdAt: 2026-05-21
updatedAt: 2026-06-02
---
## 1 两数之和

### 解法一：双指针

```go
func twoSum(nums []int, target int) []int {
	for i, n := range nums {
		for j := i + 1; j < len(nums); j++ {
			if n+nums[j] == target {
				return []int{i, j}
			}
		}
	}
	return nil
}
```

> [!tip] 题目要求**“不能使用两次相同的元素”**，因此内层循环需要从 `k1 + 1` 开始。

### 解法二：哈希表

注意到双指针解法的内层循环是为了**找到一个数 `x`，使得该数与 `n` 之和恰好为 `target`**，即 `x = target - n`。

因此，可以建立一个哈希表，**令该数为 key、该数在数组中的索引为 value**。这样，当我们需要找到数 x 对应的索引时，就相当于在哈希表中查找键对应的值。

```go
func twoSum(nums []int, target int) []int {
	hashTable := map[int]int

	for i, n := range nums {
        x := target - n

        if j, ok := hashTable[x]; ok {
            return []int{i ,j}
        }

        hashTable[n] = i
	}

    return nil
}
```

> [!tip] 题目要求**“不能使用两次相同的元素”**，因此我们不能在一开始把所有元素录入哈希表，而是先查找表中有没有自己需要的值，如果没有，就把自己存入哈希表中进行“登记”。

## 49 字母异位词分组

按定义，当且仅当两个字符串包含的字母相同时，两个字符串互为字母异位词。因此，**同一组字母异位词字符串排序后得到的字符串一定相同**。

故我们可以将排序后的字符串作为哈希表的键，字母异位词字符串数组作为对应的值。

```go
func groupAnagrams(strs []string) [][]string {
  var res [][]string 

	hashTable := map[string][]string{}

	for _, s := range strs {
		b := []byte(s)
		sort.Slice(b, func(i, j int) bool {
			return b[i] < b[j]
		})

		sortedString := string(b)

		hashTable[sortedString] = append(hashTable[sortedString], s)
	}

	for _, v := range hashTable {
    res = append(res, v)
	}

    return res
}   
```

> [!tip] **Go 的字符串排序方法**
>
> - **仅针对 ASCII 字符串**：
>
> ```go
> func sortString(s string) string {
>     r := []rune(s)
>     sort.Slice(r, func(i, j int) bool {
>         return r[i] < r[j]
>     })
>     return string(r)
> }
> ```
>
> - **字符串含有汉字等非 ASCII 字符**：
>
> ```go
> func sortString(s string) string {
>     b := []byte(s)
>     sort.Slice(b, func(i, j int) bool {
>         return b[i] < b[j]
>     })
>     return string(b)
> }
> ```

> [!tip] **Go 的 `append` 函数**
>
> `append` 是 Go 内置的可变参数函数，用于向切片末尾追加一个或多个元素，并**返回新的切片**。必须**接收返回值**，否则追加操作会丢失。

## 3 最长连续序列

这道题要求在一个未排序的整数数组中找到一个数字连续的最长序列，且**不要求序列元素在原数组中连续**。

例如，对于 `[100, 4, 200, 1, 3, 2]`，最长连续序列为 `[1, 2, 3, 4]`。

原本想的是先对数组进行排序，但题目要求**“设计并实现时间复杂度为 `O(n)`* *的算法”**，而排序复杂度为 `O(nlogn)` ，因此放弃。

我们可以发现连续序列都有以下特征：若开头数字为 `n`，则后续数字都为 `n+1, n+2, n+3, ...` 。但如果对每一个数字都去遍历数组来找它的后续，时间复杂度就来到了 `O(n²)`。

因此我们可以考虑去检查是否存在 n-1 来判断数字 n 是否是一个连续序列的开头。例如对于 100，数组中不存在 99，因此 100 是一个连续序列的开头；而对于 4，数组中存在 3，因此 4 不是连续序列的开头；同理 3 和 2 也不是；而对于 1，数组中不存在 0，因此 1 是一个连续序列的开头。

找到序列的开头后，我们再去寻找序列的后续 `n+1, n+2, n+3, ...` 。尽管这里也是一个循环，但由于确定每个数字**是否为序列起点或序列起点的后续时**最多访问两次哈希表（访问哈希表时为 `O(1)` 复杂度），因此最终复杂度为 `O(n)`。

```go
func longestConsecutive(nums []int) int {
	numSet := map[int]bool{}
	for _, n := range nums {
		numSet[n] = true
	}

	maxLength := 0
	for n := range numSet {
		// 不存在 n-1 时，n 才是一个连续序列的起点
		if !numSet[n-1] {
			currentNum := n
			currentLength := 1

			// 检查 n+1 n+2 ... 是否存在
			for numSet[currentNum+1] {
				currentNum++
				currentLength++
			}

			// 更新最长长度
			if currentLength > maxLength {
				maxLength = currentLength
			}
		}
	}

	return maxLength
} 
```