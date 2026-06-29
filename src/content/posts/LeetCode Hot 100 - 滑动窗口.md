---
title: LeetCode Hot 100 - 滑动窗口
description: 包含无重复字符的最长子串、找到字符串中所有字母异位词两道题。
tags:
  - Algorithm
createdAt: '2026-06-08 10:02:00'
updatedAt: '2026-06-15 08:48:00'
---

## **3 无重复字符的最长子串**

这道题给定一个字符串，让我们返回不重复的最长字串的长度。

我第一个想到的解法是双指针，固定左指针，让右指针去遍历整个字符串。

### 解法一：双指针

```go
func lengthOfLongestSubstring(s string) int {

	ans := 0

	// 左指针开始向右移动
	for l, _ := range s {

		// 每个字符是否出现过
		set := map[byte]bool{}

		// 右指针从左指针处开始移动
		for r := l; r < len(s); r++ {
			// 看一下这个字符是否出现过
			if _, ok := set[s[r]]; !ok {
				// 如果没有，则记录右指针对应的字符并更新长度
				set[s[r]] = true
				ans = max(ans, r-l+1)
			} else {
				// 如果出现过了，说明字符重复
				break
			}
		}
	}

	return ans
}
```

但很明显，这种解法的时间复杂度是 O(n^2)。我们需要更简单的解法。

### 解法二：滑动窗口

我们注意到双指针解法的时间复杂度主要来源于右指针需要不断回头遍历数组，如果左右指针都只向右移动，不回头，那就有望把复杂度降低到 O(n)。

如果右指针检测到了已经出现过的字符，那么左指针直接右移，使这个字符从字串中消失就好了。

```go
func lengthOfLongestSubstring(s string) int {
	ans := 0

	// 哈希表记录字符位置
	idxTable := map[byte]int{}
	l := 0

	// 右指针开始移动
	for r := 0; r < len(s); r++ {
		// 判断右指针处的字符是否出现过
		// 如果已经出现过，就移动左指针直到该字符滑出子串
		if idx, ok := idxTable[s[r]]; ok && idx >= l {
			l = idx + 1
		}

		// 如果没出现过，就记录字符位置、更新长度
		idxTable[s[r]] = r
		ans = max(ans, r-l+1)
	}
	return ans
}
```

> [!tip] **为什么滑动窗口可以做到不遗漏任何潜在最长字串？**
>
> 我们可以通过两个问题来解释。
>
> - **为什么不需要回头看那些结束地更早的字串？**
>   当右指针 r 向右移动时，我们其实是在枚举**以 s[r] 结尾的最长无重复子串**。
>   如果在移动过程中没有遇到重复字符，那么以当前 r 结尾的最长有效区间就是当前的 [l, r]。
>   那些比它短的子串（比如 [l+1, r]、[l+2, r]）由于完全被包裹在 [l, r] 内部，长度必然小于 r - l + 1。既然我们在寻找**最大长度**，这些更短的子串就没有必要再去单独计算了。
>
> - **为什么左指针可以直接跳跃？**
>   或者提问地更清楚一些：为什么当在索引 r 处发现重复字符，且它上一次出现的位置是 idx（满足 idx \ge l）时，为什么 l 可以安全地直接跳到 idx + 1，而不需要像暴力解法那样，把 l 挪到 l+1、l+2 一步步试？
>   原因在于：任何以 [l, idx] 之间的位置作为起点的子串，只要往右延伸到 r，都必然包含重复字符。
>   举个具体例子，假设字符串是 `s = "abcbda"`：
>   1. 查表发现，前一个 `'b'` 的位置是 idx = 1。
>   1. 当 r = 3 指向第二个 `'b'` 时，当前窗口是 `[a, b, c]`（[l ,r]=[0,2]）。
>   1. 此时，任何以 l=0（`'a'`）或 l=1（第一个 `'b'`）开头的子串，只要它们敢包含当前的 s[r]（第二个 `'b'`），就必然会同时包含索引 1 处的 `'b'`。因此，区间 [0, 3] 和 [1, 3] 绝对是不合法的。合法的新起点只能从 idx + 1（即索引 2，字符 `'c'`）开始。

## **438 找到字符串中所有字母异位词**

又是一道字母异位词的题。不难发现当两个字符串互为字母异位词的充要条件是**长度相等且每个字符出现的次数相同**。

~~因此我们使用哈希表记录 p 中每个字母出现的次数，再使用另一个哈希表处理窗口中每个字母出现的次数，最后判断两个哈希表相等。~~

Go 中直接判断哈希表相等并不方便，因此使用长度为 26 的数组去保存字母出现的次数。

### 解法一

```go
func findAnagrams(s string, p string) []int {

	ans := []int{}

	// 处理边界
	if len(s) < len(p) {
		return nil
	}

	// 记录p中每个字母出现的次数
	pCounts := [26]int{}
	for _, char := range p {
		pCounts[char-'a']++
	}

	for l := 0; l <= len(s)-len(p); l++ {
		// 截取滑动窗口内的字串
		str := s[l : l+len(p)]

		strCounts := [26]int{}
		for _, char := range str {
			strCounts[char-'a']++
		}

		if pCounts == strCounts {
			ans = append(ans, l)
		}
	}

	return ans
}
```

这是我首先想到的方法，是一种双指针解法。不难发现这种解法存在一些性能瓶颈。每次移动左指针时，都要截取一个新字符串，并且重新遍历计数。这导致整个算法的时间复杂度达到了 O(mn)。

### 解法二：滑动窗口

标准的滑动窗口不需要每次都重新截取字符串和重新计数。只需要维护一个大小固定为 `len(p)` 的窗口，当窗口向右移动时：

- 进来一个新字符：在计数器中给这个字符加 1。

- 移出一个旧字符：在计数器中给这个字符减 1。

这样每次窗口移动的操作都是 O(1) 的，总时间复杂度可以降到 O(n)。

```go
func findAnagrams(s string, p string) []int {
	sLen, pLen := len(s), len(p)
	if sLen < pLen {
		return []int{}
	}

	var ans []int
	var sCounts, pCounts [26]int

	// 先统计第一个窗口以及p的字符频次
	for i := 0; i < pLen; i++ {
		pCounts[p[i]-'a']++
		sCounts[s[i]-'a']++
	}

	// 检查第一个窗口是否匹配
	if sCounts == pCounts {
		ans = append(ans, 0)
	}

	// 窗口开始向右滑动
	for i := pLen; i < sLen; i++ {
		sCounts[s[i]-'a']++       // 右边界右移，加入新字符
		sCounts[s[i-pLen]-'a']--  // 左边界右移，移除旧字符

		// 每次滑动后直接比较两个数组是否相等
		if sCounts == pCounts {
			ans = append(ans, i-pLen+1)
		}
	}

	return ans
}
```
