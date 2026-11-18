<?php
/**
 * Typecho Handsome · 侧栏番茄钟控件安装脚本（幂等，可重复执行）
 *
 * 做的事：把 sidebar-pomodoro.css / sidebar-pomodoro.js 用标记块写进主题设置
 *         theme:handsome 的 customCss / customJs 字段。
 *         不改主题任何模板文件，所以主题升级不会丢；删掉标记块即卸载。
 *
 * 用法：
 *   php install-sidebar.php /path/to/typecho
 *   或：TYPECHO_ROOT=/path/to/typecho php install-sidebar.php
 *
 * 前置：
 *   1) 本脚本与 sidebar-pomodoro.css / sidebar-pomodoro.js 放在同一目录
 *   2) 已备份数据库（脚本动的是 typecho_options 一行）
 *
 * ⚠️ 只适用于 Handsome 主题且主题目录名为 handsome。
 *    换过主题目录名时，改下面的 OPTION_NAME 常量。
 *
 * 也可以不改主题设置：把 css / js 放到站点 /pomodoro/ 目录，在 customJs 里加一段
 * 加载器（见 README「外部文件方式」），这样主题设置里只多一小段。
 */
const OPTION_NAME = 'theme:handsome';
const MARK_START  = '/* JG-SIDEBAR-POMO-START */';
const MARK_END    = '/* JG-SIDEBAR-POMO-END */';

$ROOT = isset($argv[1]) ? $argv[1] : (getenv('TYPECHO_ROOT') ?: __DIR__);
$ROOT = rtrim($ROOT, '/');

if (!is_file($ROOT . '/config.inc.php')) {
    fwrite(STDERR, "找不到 {$ROOT}/config.inc.php，请传入 Typecho 站点根目录\n");
    exit(1);
}
$css = @file_get_contents(__DIR__ . '/sidebar-pomodoro.css');
$js  = @file_get_contents(__DIR__ . '/sidebar-pomodoro.js');
if (!$css || !$js) {
    fwrite(STDERR, "缺少同目录的 sidebar-pomodoro.css / sidebar-pomodoro.js，中止\n");
    exit(1);
}
echo "站点根目录: $ROOT\n";
echo "读取 sidebar-pomodoro.css " . strlen($css) . " 字节 / sidebar-pomodoro.js " . strlen($js) . " 字节\n";

// ---- 从 Typecho 的 config.inc.php 里取数据库连接信息，不硬编码任何凭据 ----
function parse_db_config($file) {
    $c = file_get_contents($file);
    preg_match_all("/['\"](host|user|password|database|port)['\"]\s*=>\s*['\"]([^'\"]*)['\"]/", $c, $m);
    if (empty($m[1])) return null;
    return array_combine($m[1], $m[2]);
}
$cfg = parse_db_config($ROOT . '/config.inc.php');
if (!$cfg || empty($cfg['database']) || empty($cfg['user'])) {
    fwrite(STDERR, "无法从 config.inc.php 解析数据库配置，中止（请检查文件是否为标准 Typecho 格式）\n");
    exit(1);
}
$db = @new mysqli($cfg['host'], $cfg['user'], $cfg['password'], $cfg['database'], (int)($cfg['port'] ?? 3306));
if ($db->connect_errno) {
    fwrite(STDERR, "数据库连接失败: " . $db->connect_error . "\n");
    exit(1);
}
$db->set_charset('utf8mb4');

$res = $db->query("SELECT value FROM typecho_options WHERE name='" . OPTION_NAME . "'");
if (!$res || !($row = $res->fetch_assoc())) {
    fwrite(STDERR, "找不到 " . OPTION_NAME . " 配置行，确认当前启用的是 Handsome 主题\n");
    exit(1);
}
$orig = $row['value'];
$d = json_decode($orig, true);
if (!is_array($d)) {
    fwrite(STDERR, "主题配置不是合法 JSON，中止\n");
    exit(1);
}
$before = count($d);

// ---- 备份原始配置 ----
$BAK = dirname($ROOT) . '/pomodoro-backup';
if (!is_dir($BAK)) @mkdir($BAK, 0755, true);
$bakFile = $BAK . '/theme_handsome_bak_' . date('Ymd_His') . '.json';
@file_put_contents($bakFile, $orig);
echo "备份 -> " . (is_file($bakFile) ? $bakFile : '(写入失败，请手动备份数据库)') . "\n";

// ---- 幂等替换：先剥掉旧标记块，再追加新块 ----
function stripBlock($s, $start, $end) {
    $p = strpos($s, $start);
    if ($p === false) return rtrim($s);
    $q = strpos($s, $end, $p);
    if ($q === false) return rtrim(substr($s, 0, $p));
    return rtrim(substr($s, 0, $p) . substr($s, $q + strlen($end)));
}
$d['customCss'] = stripBlock($d['customCss'] ?? '', MARK_START, MARK_END) . "\n\n" . trim($css) . "\n";
$d['customJs']  = stripBlock($d['customJs']  ?? '', MARK_START, MARK_END) . "\n\n" . trim($js)  . "\n";

$new = json_encode($d, JSON_UNESCAPED_UNICODE);
$st = $db->prepare("UPDATE typecho_options SET value=? WHERE name='" . OPTION_NAME . "'");
$st->bind_param('s', $new);
$st->execute();
echo "写回影响行数: {$st->affected_rows}\n";

// ---- 回读校验：字段数不能变，标记只能各出现一次 ----
$chk = $db->query("SELECT value FROM typecho_options WHERE name='" . OPTION_NAME . "'")->fetch_assoc();
$cd = json_decode($chk['value'], true);
echo "\n=== 回读校验 ===\n";
echo "  字段数 $before -> " . count($cd) . ($before === count($cd) ? " OK" : " 异常，请从备份恢复") . "\n";
echo "  customCss 标记数 " . substr_count($cd['customCss'], MARK_START) . "\n";
echo "  customJs  标记数 " . substr_count($cd['customJs'],  MARK_START) . "\n";
echo "  themetype=" . ($cd['themetype'] ?? '-') . "\n";
echo "\n完成。若前台仍显示旧内容，清一次 CDN / 浏览器缓存。\n";
