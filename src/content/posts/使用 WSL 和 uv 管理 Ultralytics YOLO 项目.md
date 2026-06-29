---
title: 使用 WSL 和 uv 管理 Ultralytics YOLO 项目
description: 本文探索使用 WSL 和 uv 替代 conda 进行 Ultralytics YOLO 项目依赖的管理。
tags:
  - Python
  - YOLO
  - Linux
createdAt: '2026-03-19 18:47:00'
updatedAt: '2026-06-07 21:13:00'
---

## 环境初始化

### 安装 WSL

适用于 Linux 的 Windows 子系统（Windows Subsystem for Linux，WSL）在 Windows 系统中提供了 Linux 的实现，并且和 Windos 在硬件和文件系统上实现互通。

为确保最佳兼容性，建议使用 Windows 11 22H2 及以上版本的系统。

以管理员身份打开 PowerShell，输入：

```powershell
wsl --install Ubuntu-24.04
```

即可启用 WSL 并安装 Ubuntu 发行版。

### 安装 uv

你可以在这里找到 [uv](https://docs.astral.sh/uv/getting-started/installation/) 的全部安装方式。Linux 使用下列命令安装：

```bash
wget -qO- https://astral.sh/uv/install.sh | sh
```

使用 `uv init hello-deeplearning` 将创建一个新项目 `hello-deeplearning` ，其中包含以下文件：

```bash
hello-deeplearning
├── .gitignore
├── .python-version
├── README.md
├── main.py
└── pyproject.toml
```

其中 `pyproject.toml` 是主要关注的文件。关于该文件的更多信息，可以参考 [Writing your pyproject.toml](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/)。

## 使用 uv 维护依赖

### PyTorch

得益于 PyTorch 官方维护了使用 CUDA 编译的 PyTorch，使其成为了一个普通的 PyPi 包。我们可以不再使用 Conda 管理繁琐的 CUDA 依赖。

你可以在 [Installing previous versions of PyTorch](https://pytorch.org/get-started/previous-versions/) 页面找到全部 PyTorch 版本及其安装命令。

以 **[torch 2.5.1+cu124](https://pytorch.org/get-started/previous-versions/#:~:text=pip%20install%20torch%3D%3D2.5.1%20torchvision%3D%3D0.20.1%20torchaudio%3D%3D2.5.1%20%2D%2Dindex%2Durl%20https%3A//download.pytorch.org/whl/cu124)** 为例，pip 命令是这样的：

```bash
pip install torch==2.5.1 torchvision==0.20.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cu124
```

而对于 uv 项目，我们需要在 `pyproject.toml` 中指定来源：

```toml
# 这里指定一个名为 torch-cu124 的源及其 URL
[[tool.uv.index]]
name = "torch-cu124"
url = "https://download.pytorch.org/whl/cu124"
explicit = true

# 这里令 torch torchvision torchaudio 三个包使用 torch-cu124 源
[tool.uv.sources]
torch = { index = "torch-cu124" }
torchvision = { index = "torch-cu124" }
torchaudio = { index = "torch-cu124" }
```

然后使用 `uv add` 安装依赖：

```bash
uv add torch==2.5.1 torchvision==0.20.1 torchaudio==2.5.1
```

使用以下命令验证安装：

```bash
uv run python -c "import torch; print('Torch version:', torch.__version__); print('CUDA available:', torch.cuda.is_available()); print('CUDA version:', torch.version.cuda); print('Current device:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')"
```

```
Torch version: 2.5.1+cu124
CUDA available: True
CUDA version: 12.4
Current device: NVIDIA GeForce RTX 4060 Ti
```

### Ultralytics

如果不改进网络结构，我们只需要 `uv add ultralytics` 安装官方包即可。否则，我们需要克隆 Ultralytics 仓库后以可编辑模式安装 `ultralytics` 。首先克隆仓库到项目下：

```bash
git clone https://github.com/ultralytics/ultralytics.git
```

```
hello-deeplearning
├── .gitignore
├── .python-version
├── README.md
├── main.py
├── pyproject.toml
└── ultralytics # Ultralytics 仓库
```

并在 `pyproject.toml` 中将 `ultralytics` 设为本地源，并设为可编辑：

```toml
[tool.uv.sources]
ultralytics = { path = "ultralytics", editable = true }
```

然后使用 `uv add` 添加依赖：

```bash
uv add ultralytics
```

使用以下命令验证安装：

```bash
uv run python -c "import importlib.util as iu; s=iu.find_spec('ultralytics'); print('Ultralytics installed:', s is not None); m=__import__('ultralytics') if s else None; print('Ultralytics version:', getattr(m,'__version__','N/A')); print('Ultralytics path:', getattr(m,'__file__','N/A')); print('YOLO import OK:', hasattr(m,'YOLO') if m else False)"
```

```
Ultralytics installed: True
Ultralytics version: 8.4.23
Ultralytics path: /home/yoake/hello-deeplearning/frames/ultralytics/ultralytics/__init__.py
YOLO import OK: True
```

### ONNX

如果要将 YOLO 模型导出为 ONNX 格式，Ultralytics 会自动下载安装 ONNX 相关的依赖。但这一步经常卡死，建议在这之前手动安装依赖：

```bash
uv add "onnx>=1.12.0,<2.0.0" "onnxruntime>=1.26.0" "onnxslim>=0.1.71"
```
