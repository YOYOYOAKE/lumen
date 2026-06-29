---
title: 将 YOLO 编译为 Hailo NPU 适用的 HEF 模型
description: 本文记录了编译 YOLO11m 为 HEF 模型的完整过程。
tags:
  - Python
  - YOLO
  - Linux
createdAt: '2026-05-14 16:19:00'
updatedAt: '2026-06-08 10:06:00'
---

> [!tip] 这里只建议部署原版未经修改的 Ultralytics YOLO 模型。

## 导出 ONNX 模型

在训练机上将训练好的 YOLO 模型导出为 ONNX：

```bash
yolo export model=best.pt format=onnx
```

| **参数名** | **类型** | **默认值** | **说明** |
| **`format`** | `str` | `None` | **目标导出格式**。固定设置为 `'onnx'`。 |
| **`imgsz`** | `int` 或 `tuple` | `640` | 模型输入的图像尺寸。例如 `imgsz=640` 或 `imgsz=(480, 640)`。 |
| **`dynamic`** | `bool` | `False` | **动态输入尺寸**。若设为 `True`，导出的模型将支持不同的 Batch Size 或图像宽高。 |
| **`simplify`** | `bool` | `True` | **简化模型**。利用 `onnx-simplifier` 自动融合算子、消除冗余节点，能显著提升推理效率，推荐保持 `True`。 |
| **`opset`** | `int` | `None` | **指定 ONNX 的 Opset 版本**（如 `11`、`12`、`17` 等）。不指定时默认使用推荐的稳定版本。 |
| **`half`** | `bool` | `False` | **FP16 半精度量化**。能减小模型体积并加速 GPU 推理（注意：部分只支持 FP32 的边缘设备可能不兼容）。 |
| **`int8`** | `bool` | `False` | **INT8 量化**。一般用于边缘端 CPU/NPU 部署，开启前通常需要提供校准数据集。 |
| **`device`** | `str` 或 `int` | `None` | **指定导出时使用的设备**。如 `"cpu"` 或 `"0"` (GPU)。 |

## 编译 HEF 模型

### 校准集准备

在编译过程中需要 500~2000 张图片制作**校准集**，用于 INT8 量化时统计模型各层激活值范围。校准集只需要图片，不需要标签。

### 安装 **AI Software Suite Docker**

本次最终采用 Hailo 官方提供的 **Hailo AI Software Suite – Docker** 完成编译，以避免手动安装 DFC、Model Zoo、PyTorch 等依赖。

从 [Hailo Software Downloads 页面](https://hailo.ai/developer-zone/software-downloads/?product=ai_accelerators&device=hailo_8_8l)下载并解压 Hailo AI Software Suite – Docker 后，目录中会有类似文件：

```
hailo_ai_suite/
├── hailo_ai_sw_suite_docker_run.sh
├── hailo8_ai_sw_suite_2025-10.tar.gz
└── shared_with_docker/
```

`shared_with_docker` 是宿主机和容器之间共享文件的目录。把 ONNX 模型和校准集放进去：

```
shared_with_docker/
├── models/
│   └── yolo11m-20260514.onnx
└── calib/
    └── images/
        ├── xxx.jpg
        ├── yyy.jpg
        └── ...
```

启动容器：

```bash
cd ~/hailo_ai_suite && sudo ./hailo_ai_sw_suite_docker_run.sh
```

这一步会直接进入 Hailo AI Software Suite** **容器中：

```
./hailo_ai_sw_suite_docker_run.sh: line 14: lspci: command not found
xauth:  file /root/.Xauthority does not exist
xauth: (argv):1:  unable to read any entries from file "(stdin)"
Starting new container
Running Hailo AI SW suite Docker image with the folowing Docker command:
docker run --privileged --net=host -e DISPLAY=:0 -e XDG_RUNTIME_DIR= --device=/dev/dri:/dev/dri --ipc=host --group-add 44 -v /dev:/dev -v /lib/firmware:/lib/firmware -v /lib/modules:/lib/modules -v /lib/udev/rules.d:/lib/udev/rules.d -v /usr/src:/usr/src -v /tmp/hailo_docker.xauth:/home/hailo/.Xauthority -v /tmp/.X11-unix/:/tmp/.X11-unix/ --name hailo8_ai_sw_suite_2025-10_container -v /var/run/docker.sock:/var/run/docker.sock -v /etc/machine-id:/etc/machine-id:ro -v /var/run/dbus/system_bus_socket:/var/run/dbus/system_bus_socket -v /home/yoake/hailo_ai_suite/shared_with_docker/:/local/shared_with_docker:rw -v /etc/timezone:/etc/timezone:ro -v /etc/localtime:/etc/localtime:ro -ti hailo8_ai_sw_suite_2025-10:1

==========
== CUDA ==
==========

CUDA Version 11.8.0

Container image Copyright (c) 2016-2023, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

This container image and its contents are governed by the NVIDIA Deep Learning Container License.
By pulling and using the container, you accept the terms and conditions of this license:
https://developer.nvidia.com/ngc/nvidia-deep-learning-container-license

A copy of this license is made available in this container at /NGC-DL-CONTAINER-LICENSE for your convenience.

WARNING: The NVIDIA Driver was not detected.  GPU functionality will not be available.
   Use the NVIDIA Container Toolkit to start this container with GPU support; see
   https://docs.nvidia.com/datacenter/cloud-native/ .



Welcome to Hailo AI Software Suite Container
To list available commands, please type:

----------------------------------------------------------------------

HailoRT:                                hailortcli -h
Dataflow Compiler:                      hailo -h
Hailo Model Zoo:                        hailomz -h
Run TAPPAS Detection Application:       tappas/detection/detection.sh

----------------------------------------------------------------------


(hailo_virtualenv) hailo@docker-desktop:/local/workspace$
```

> [!tip] 如果宿主机提示缺少 `lspci`，可以安装：
>
> ```bash
> sudo apt install pciutils
> ```

进入容器后，宿主机的共享目录会映射到 `/local/shared_with_docker` 。

### 编译 HEF 模型

对于原版 YOLO11m 模型，可以直接使用 Hailo Model Zoo 的 `hailomz compile` ，不需要人工设置编译参数，只需要额外指定类别数目。

```bash
hailomz compile yolov11m \
  --ckpt /local/shared_with_docker/models/yolo11m.onnx \
  --calib-path /local/shared_with_docker/calib/images \
  --hw-arch hailo8 \
  --classes 5
```

这条命令会自动完成量化校准、Quantization-Aware Fine-Tuning、硬件资源切分、资源映射和 HEF 构建全部流程。YOLO11m 属于中等规模模型，在无 GPU 或 CPU 编译环境下耗时较长是正常现象。

以下是编译过程中出现的关键日志。

```
[warning] Quantization-Aware Fine-Tuning: Dataset didn't have enough data for dataset_size of 1024
[info] Starting Quantization-Aware Fine-Tuning
[info] Using dataset with 512 entries for finetune
Epoch 1/4
```

这表示校准图片数量不足官方推荐的 1024 张，但仍会使用当前 512 张图片继续进行量化微调。

量化优化完成后，会保存 HAR：

```
[info] Model Optimization Algorithm Quantization-Aware Fine-Tuning is done (completion time is 00:43:25.87)
[info] Model Optimization is done
[info] Saved HAR to: /local/workspace/yolov11m.har
```

随后进入 Hailo-8 编译阶段。如果单 context 放不下，编译器会自动切换到 multi-context：

```
[info] Starting Hailo allocation and compilation flow
[info] Trying to compile the network in a single context
[info] Single context flow failed: Recoverable single context error
[info] Using Multi-context flow
```

对于 YOLO11m，最终被切分为 3 个 context：

```
[info] Partition to contexts finished successfully
[info] Partitioner finished after 178 iterations, Time it took: 45m 13s 95ms
[info] Applying selected partition to 3 contexts...
[info] Validating layers feasibility
[info] Layers feasibility validated successfully
```

随后进行 Hailo-8 硬件资源映射：

```
[info] Running resources allocation (mapping) flow, time per context: 59m 59s
[info] Successful Mapping (allocation time: 48m 22s)
```

最后生成 HEF：

```
[info] Compiling kernels of yolov11m_context_0...
[info] Compiling kernels of yolov11m_context_1...
[info] Compiling kernels of yolov11m_context_2...
[info] Building HEF...
[info] Successful Compilation (compilation time: 22s)
<Hailo Model Zoo INFO> HEF file written to yolov11m.hef
```

生成文件通常位于容器当前工作目录，例如 `/local/workspace/yolov11m.hef`。 将其复制回共享目录：

```bash
cp /local/workspace/yolov11m.hef /local/shared_with_docker/yolo11m-20260514_h8.hef
```

退出容器：

```bash
exit
```

回到宿主机后即可在这里拿到最终模型：

```
~/hailo_ai_suite/shared_with_docker/yolo11m-20260514_h8.hef
```
