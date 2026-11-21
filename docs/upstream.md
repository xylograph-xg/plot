# GitHub 开源调研

调研日期：2026-11-16。通过 GitHub 仓库搜索和网页搜索覆盖科研制图、CSV 图表编辑、拖拽式数据探索；对下表五个直接相关的仓库执行了 `git clone --depth 1`。提交是这次阅读的基线，和最新发布版本未必相同。下表的功能判断来自官方文档和本地源码。

| 项目 | 本地源码 / 提交 | 与工具箱的关系 | 许可证及用途 |
| --- | --- | --- | --- |
| [SciPlot](https://github.com/WB666706/sciplot) | [sciplot](../references/sciplot) · `40d96ce1` | 最接近的起点。CSV/TSV/Excel、粘贴、表格、字段映射、X/Y/右 Y、误差棒、组图、标注和工程导出。React + TypeScript + ECharts，可在浏览器中本地处理数据。 | MIT。适合试改；分发时保留许可与版权声明。 |
| [Veusz](https://github.com/veusz/veusz) | [veusz](../references/veusz) · `d9401b33` | Python + Qt 的科研绘图应用，部分加速代码用 C++。数据集和绘图对象分离，支持多轴、断轴、拟合、矢量导出和脚本。 | GPL-2.0-or-later；可直接使用，也是科学图形功能和架构的参考。 |
| [LabPlot](https://github.com/KDE/labplot) | [labplot](../references/labplot) · `dedc4c54` | C++/Qt/KDE，覆盖工作簿、复杂导入、图形、拟合和信号分析。适合参考怎样组织成熟的分析功能；桌面工程体量对个人工具偏大。 | 多许可证，具体以源码 SPDX 和 [LICENSES](../references/labplot/LICENSES) 为准；本方案参考工作流。 |
| [Graphic Walker](https://github.com/Kanaries/graphic-walker) | [graphic-walker](../references/graphic-walker) · `a4b3bc1e` | 字段拖拽、分组聚合、浏览器 Worker 与可替换的查询后端。适合参考探索式选取和计算接口，科研排版可由独立工作台负责。 | 主代码 Apache-2.0，Kanaries 标识另见 [LICENSE2](../references/graphic-walker/LICENSE2)；嵌入时检查品牌条款。 |
| [D-Tale](https://github.com/man-group/dtale) | [dtale](../references/dtale) · `d34f0a57` | Python 数据框浏览，表格筛选、排序、数据质量检查、合并、派生列和代码导出。研究数据面板很有启发；可作为 Python 探索工具单独使用。 | 仓库 [LICENSE](../references/dtale/LICENSE) 为 LGPL-2.1 文本。 |

其他看过的候选：[PyGWalker](https://github.com/Kanaries/pygwalker) 适合在 Python/Jupyter 中接上拖拽式分析，与 Graphic Walker 的参考价值重叠；[PlotJuggler](https://github.com/PlotJuggler/PlotJuggler) 对实时多通道时序很有参考价值，等有实时需求再拉取；[Plotly.py](https://github.com/plotly/plotly.py) 和 [Matplotlib](https://github.com/matplotlib/matplotlib) 是渲染库，按路线选择依赖即可。

## SciPlot 值得借用什么，先改什么

| 源码线索 | 看到的实现 | 对本项目的影响 |
| --- | --- | --- |
| [parse.ts](../references/sciplot/src/lib/parse.ts) | 文件读入内存；导入时自动将可转成数字的字符串转成数字。 | `00123` 这类样品编号需要能显式保留为文本。Excel 要能选工作表和数据区域；CSV 需要处理列名冲突、坏行和编码。 |
| [types.ts](../references/sciplot/src/types.ts) / [echartsOption.ts](../references/sciplot/src/lib/echartsOption.ts) | 图层按列下标绑定；XY 生成阶段会略过无效 Y 值，支持分组；轴配置已有线性、对数和范围等选项。 | 先把筛选、排序、缺失处理抽到独立数据视图里，图层改绑稳定列 ID。坐标轴可视范围与数据筛选应是两个操作。 |
| [useStore.ts](../references/sciplot/src/store/useStore.ts) | 工程保存包含数据和图形；撤销历史包含数据集，在状态相等检查里调用 JSON.stringify。 | 对大表的内存和交互延迟先量后改。原始数据应只读，撤销记录配置或编辑差量，重复绘图优先保存配方。 |
| [export.ts](../references/sciplot/src/lib/export.ts) | 从当前页面合成 SVG，再生成 PNG 或 PDF；PNG 用 DPI 计算像素尺寸；工程读取当前主要检查应用标记。 | 需要实际验证中文字体、物理尺寸、透明背景、裁切与 PNG DPI 元数据。批处理要明确是否复用同一浏览器渲染路径；工程文件要做版本和结构校验。 |

源仓库本次只作为参考克隆，未改写、安装项目依赖到工作区或启动常驻服务。重取时可使用 `git clone --depth 1 https://github.com/<组织>/<仓库>.git references/<仓库>`；如需精确复现，先确认检出的提交与表格一致。

## 本机验证

在隔离的临时目录，用 Node 24 在 macOS arm64 上执行 `npm ci --ignore-scripts` 和 `npm run build`，构建通过。随后用本机无头 Chrome 加载产物、导入内置示例、添加一个序列并导出 SVG、PNG 和 PDF，三个文件均已生成并核验格式。默认 300 DPI 选项生成的 PNG 为 1419 × 1063 像素，这次样本文件没有 `pHYs` 像素密度元数据；如果下游按元数据识别物理尺寸，需要补写并验证。真实数据、中文字体、精确版面与大表性能留在阶段 0 验收。五个源码克隆已核对提交号和远程地址，工作树干净，总计约 199 MB。
