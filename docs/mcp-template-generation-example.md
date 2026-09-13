# MCP 模板生成示例

下面是第一阶段的最小使用流程。它只生成并保存工作流，不会启动 MuMu，也不会执行点击。

## 用户需求

> 帮我制作一个模板：检测阴阳师图标，找到后点击匹配结果中心。

## AI 应先查询

```text
list_actions()
list_workflows()
list_assets()
```

然后确认：

- 使用 `vision.match_template` 做图片匹配。
- 使用 `input.tap_match` 点击匹配结果。
- 图片资源使用已有的 `assets/templates/start/yys_tubiao.png`。

## AI 生成的工作流

```json
{
  "schema_version": 4,
  "id": "detect-and-tap-yys-icon",
  "version": "1.0.0",
  "description": "检测阴阳师图标并点击其匹配中心",
  "resolution": [1920, 1080],
  "root": "root",
  "inputs": {
    "icon_template": {
      "type": "asset",
      "default": "assets/templates/start/yys_tubiao.png",
      "description": "阴阳师图标模板"
    }
  },
  "variables": {},
  "nodes": [
    {"id": "root", "type": "root", "children": ["main"]},
    {"id": "main", "type": "sequence", "children": ["find_icon", "tap_icon"]},
    {
      "id": "find_icon",
      "type": "task",
      "action": "vision.match_template",
      "params": {
        "template": {"ref": "inputs.icon_template"}
      }
    },
    {
      "id": "tap_icon",
      "type": "task",
      "action": "input.tap_match",
      "params": {
        "match": {"ref": "nodes.find_icon.output.0"}
      }
    }
  ]
}
```

## AI 应调用

```text
validate_workflow(workflow_json)
```

校验通过后再调用：

```text
save_workflow_template(
  workflow_json,
  name="detect-and-tap-yys-icon",
  description="检测阴阳师图标并点击其匹配中心"
)
```

预期结果：

```json
{
  "ok": true,
  "saved": true,
  "path": "workflows/generated/detect-and-tap-yys-icon.json",
  "workflow_id": "detect-and-tap-yys-icon",
  "version": "1.0.0"
}
```

用户仍应在桌面端打开模板，确认图片、节点和点击行为后再运行。

## 从设备截图生成新模板

当现有图片资源不够时，可以先读取当前画面，再从截图中裁剪模板：

```text
capture_screen(instance_id="mumu-0")
```

该工具返回截图图片块、截图尺寸和临时 `capture_id`。如果希望使用项目自带的可视化
框选程序，可以调用：

```text
select_roi(capture_id="上一调用返回的 capture_id")
```

用户在窗口中拖拽并确认后，工具会返回 `image_rect` 和 `reference_rect`。也可以由
AI 根据截图直接确定实际像素 ROI `[x, y, width, height]`，然后调用：

```text
create_template_asset(
  capture_id="上一调用返回的 capture_id",
  roi=[x, y, width, height],
  name="challenge_button"
)
```

图片会保存到 `assets/templates/generated/challenge_button.png`，并返回裁剪后的
图片预览。截图缓存只保留最近几次调用，过期后需要重新截图。上述流程只读取设备
画面、打开本地 ROI 窗口和写入模板文件，不发送点击、滑动、按键或文字输入。
