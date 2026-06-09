---
title: LeetCode Hot 100 - 双指针
description: 包含移动零、盛水最多的容器、三数之和三道题。
tags:
  - Algorithm
createdAt: '2026-05-27'
updatedAt: '2026-06-09'
---

## 283 移动零

这道题要求在原数组上进行操作，因此只能通过交换数组内元素的方法解决。

我们设置左右两个指针进行操作。两个指针的初始位置均为 0，右指针先遍历数组，找到非零数时就和左指针交换，同时左指针右移。

例如对于数组 `[0,1,0,3,12]`：

- 初始时 L=0，R=0；

- R 右移，此时 R=1 为非零数 `1`，与 L 交换，L 右移。此时数组变为 `[1,0,0,3,12]` ；

- 此时 L=1，R=1；

- R 继续右移，此时 R=2 为 `0` ，不进行操作；

- 此时 L=1，R=2；

- R 继续右移，此时 R=3 为非零数 `3`，与 L 交换，L 右移。此时数组变为 `[1,3,0,0,12]` ；

- 此时 L=2，R=3；

- R 继续右移，此时 R=4 为非零数 `12`，与 L 交换，L 右移。此时数组变为 `[1,3,12,0,0]` ；

- R 遍历到尾部，结束。

```go
func moveZeroes(nums []int) {

	// 左右指针置于零位，保存指针上限
	l, r := 0, 0

	// 右指针依次右移
	for r < len(nums) {
		// 如果右指针的数字非零，就和左指针的数字交换，同时左指针左移
		if nums[r] != 0 {
			nums[l], nums[r] = nums[r], nums[l]
			l++
		}

        // 否则，右指针继续找下一个非零数字
		r++
	}
}
```

## 11 盛水最多的容器

按题意，容器的水量为两壁高度的较小值与两壁之间距离乘积。因此一个比较容易想到的方法是双重循环遍历数组，得到水量最多的组合。但这样的复杂度是 `O(n²)`。

如果采用两个指针分别从数组左侧和右侧开始遍历，使得每个数组元素则最多被访问一次，此时时间复杂度有望降为 `O(n)`。

我们移动指针是为了取到更多的水，因此优先移动短板。

```go
func maxArea(height []int) int {
	l, r := 0, len(height)-1

	ans := 0

	for l < r {
		a := min(height[l], height[r]) * (r - l)
		ans = max(ans, a)

		if height[l] <= height[r] {
			l++
		} else {
			r--
		}
	}
	return ans
}
```

## 15 三数之和

这道题要求三个数字 `nums[i], nums[j], nums[k]` 在数组中的位置互不相同且和为 0，我们很容易想到使用三重循环。

不过这个方案也很容易优化。结合上一道题的思路，我们可以固定 `nums[i]`，用左右两个指针相向遍历数组，从而省下一层循环。

```go
func threeSum(nums []int) [][]int {
	ans := [][]int{}

	// 排序
	sort.Ints(nums)

	// 遍历给定数组得到nums[i]
	for i, _ := range nums {
		// 去重，如果nums[i]==nums[i-1]，跳过
		if i > 0 && nums[i] == nums[i-1] {
			continue
		}

		// 目标为nums[j]+nums[k]+nums[i]==0
		// 这里可以考虑左右两个指针从两侧遍历数组
		// 左指针从 i+1 处开始向右遍历，因为之前的都已经处理过了
		// 右指针从数组末端开始向左遍历
		l, r := i+1, len(nums)-1

		for l < r {
			sum := nums[l] + nums[r] + nums[i]

			// 若sum为0
			if sum == 0 {
				ans = append(ans, []int{nums[l], nums[r], nums[i]})
                
                // 移动指针查找下一组nums[l]和nums[r]
                l++
                r--

				// 跳过重复元素
				for l < r && nums[l] == nums[l-1] {
					l++
				}
				for l < r && nums[r] == nums[r+1] {
					r--
				}
			}

			// 若sum小于0，说明nums[l]小了，向后查找更大的
			if sum < 0 {
				l++
			}

			// 若sum大于0，说明nums[r]大了，向前查找更大的
			if sum > 0 {
				r--
			}
		}
	}

	return ans
}
```
