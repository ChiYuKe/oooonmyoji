/** User-facing names for action and parameter metadata. */
const FIELD_LABELS: Record<string, string> = {
  value: '值', message: '提示信息', fields: '字段列表', name: '名称', seconds: '时长（秒）',
  match: '匹配配置', template: '模板', template_roi: '模板区域', done_texts: '完成文字',
  done_roi: '完成区域', done_states: '完成状态', allow_ocr: '允许 OCR', timeout_seconds: '超时（秒）',
  max_clicks: '最大点击次数', threshold: '匹配阈值', post_click_delay: '点击后延迟（秒）',
  stable_seconds: '稳定时长（秒）', hold_ms: '按压时长（毫秒）', random_offset: '随机偏移（px）',
  random_interval: '随机间隔（秒）', keycode: '按键代码', states: '状态列表', target_states: '目标状态',
  overlay_states: '覆盖层状态', transitions: '状态转移', initial_state_timeout_seconds: '初始状态超时（秒）',
  confirm_timeout_seconds: '确认超时（秒）', poll_interval_seconds: '轮询间隔（秒）',
  post_action_delay: '动作后延迟（秒）', max_return_attempts: '最大返回次数', max_overlay_clicks: '覆盖层点击上限',
  max_transitions: '最大转移次数', failure_frame_name: '失败现场图名', x1: '左', y1: '上', x2: '右', y2: '下',
  duration_ms: '时长（毫秒）', x: '坐标 X', y: '坐标 Y', revalidate: '重新校验',
  verify_gone: '确认模板消失', verify_timeout_seconds: '确认消失超时（秒）',
  disappeared_states: '消失状态列表', disappeared_state_timeout_seconds: '消失超时（秒）', text: '文字',
  target_rois: '目标区域列表', page_roi: '页面区域', completed_texts: '完成文字列表',
  completed_templates: '完成模板列表', min_confidence: '最小置信度', target_limit: '目标数量上限',
  roi: '识别区域', minimum_passes: '最少通过次数', key_texts: '关键文字', category: '类别', layer: '层级',
  track_realm_pass: '结界通过检测', realm_threshold: '结界阈值', realm_pass_template: '结界通过模板',
  realm_pass_threshold: '结界通过阈值', realm_popup_roi: '结界弹窗区域', realm_popup_timeout_seconds: '结界弹窗超时（秒）',
  realm_popup_close_point: '结界弹窗关闭位置', max_results: '最大匹配数', scale_search: '多尺度搜索',
  templates: '模板列表', texts: '文字列表', present: '存在性', allow_timeout: '允许超时', workflow: '子工作流',
  inputs: '输入', workflows: '工作流列表', condition: '结束条件', conditions: '分支条件', expression: '表达式',
  cases: '分支映射', max_iterations: '最大迭代次数', default_child: '默认子节点', children: '子节点',
  wait_for: '完成条件', cancel_on_failure: '失败时取消', runs: '实例运行项', finish_mode: '结束模式',
  from: '起始状态', type: '触发方式', expected_states: '预期状态', retry_if_unchanged_seconds: '无变化重试等待（秒）',
  return_action: '返回键操作', required_texts: '校验文字', required_text_roi: '校验文字区域',
  required_text_min_confidence: '校验文字置信度', text_roi: '文字区域',
};

const ENUM_LABELS: Record<string, string> = {
  tap_match: '点击匹配项', tap_template: '点击模板', tap: '坐标点击', key: '按键',
  all: '全部完成', any: '任一完成',
};

export const ACTION_LABELS: Record<string, string> = {
  'core.assert': '断言校验', 'core.capture': '截取画面', 'core.log': '输出日志',
  'core.save_frame': '保存现场图', 'core.sleep': '等待',
  'input.dismiss_template_until_text': '点模板关闭至文字出现', 'input.key': '发送按键',
  'input.recover_state': '页面状态恢复', 'input.swipe': '滑动', 'input.tap': '坐标点击',
  'input.tap_match': '点击匹配项', 'input.type_text': '输入文本',
  'vision.detect_state': '识别页面状态', 'vision.match_template': '模板匹配', 'vision.ocr': '文字识别',
  'vision.wait_any': '等待任一模板', 'vision.wait_any_text': '等待任一文字',
  'vision.wait_template': '等待模板', 'vision.wait_text': '等待文字',
  'workflow.run': '运行子工作流', 'workflow.select': '子流程选择器', 'workflow.sequence': '子流程序列',
};

export const fieldLabel = (name: string): string => FIELD_LABELS[name] || name;
export const enumOption = (value: string): string => ENUM_LABELS[value] === undefined ? value : `${ENUM_LABELS[value]}（${value}）`;
export const actionLabel = (name: string): string => ACTION_LABELS[name] || name;
