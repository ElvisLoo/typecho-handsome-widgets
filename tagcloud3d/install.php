<?php
/**
 * 标签云 3D 球体挂件安装器（幂等）
 *
 *   php install.php <Typecho 站点根目录> [主题目录名，默认 handsome]
 *
 * 1. 复制 tagcloud3d.js / .css 到 <站点根>/tagcloud3d/
 * 2. customJs：插入 / 替换 loader（标记块 JG-TAGCLOUD3D）
 * 3. 改库前备份整份主题配置到 /www/backup/jikegang/
 * 4. 回读校验：字段数不变、其它注入块不受影响
 */
if (PHP_SAPI !== 'cli') { die("请在命令行运行\n"); }

$root = isset($argv[1]) ? rtrim($argv[1], '/\\') : '';
$theme = isset($argv[2]) ? $argv[2] : 'handsome';
if (!$root || !is_file($root . '/config.inc.php')) {
    die("用法: php install.php <Typecho 站点根目录> [主题目录名]\n");
}
$src = __DIR__;

$c = file_get_contents($root . '/config.inc.php');
preg_match_all("/'(host|user|password|database|port|charset)'\s*=>\s*'([^']*)'/", $c, $m);
$cfg = array_combine($m[1], $m[2]);
$db = @new mysqli($cfg['host'], $cfg['user'], $cfg['password'], $cfg['database'], (int)($cfg['port'] ?: 3306));
if ($db->connect_error) die("数据库连接失败\n");
$db->set_charset('utf8mb4');

$optName = 'theme:' . $theme;
$r = $db->query("SELECT value FROM typecho_options WHERE name='" . $db->real_escape_string($optName) . "'");
$row = $r->fetch_assoc();
if (!$row) die("找不到主题配置\n");
$options = json_decode($row['value'], true);
if (!is_array($options)) die("主题配置不是合法 JSON\n");
$beforeCount = count($options);

/* --- 备份 --- */
$bakDir = '/www/backup/jikegang';
if (!is_dir($bakDir)) @mkdir($bakDir, 0755, true);
$bak = $bakDir . '/theme_handsome_before_tagcloud3d_' . date('Ymd_His') . '.json';
file_put_contents($bak, $row['value']);

/* --- 静态文件：deploy.js 已把 js/css 放到 <站点根>/tagcloud3d/，
   这里只确认它们存在，缺失才从源码目录补 --- */
$src = __DIR__;                       /* 服务器端就是 <站点根>/tagcloud3d */
$dstDir = $root . '/tagcloud3d';
if (!is_dir($dstDir)) @mkdir($dstDir, 0755, true);
foreach (array('tagcloud3d.js', 'tagcloud3d.css') as $f) {
    if (!is_file($dstDir . '/' . $f)) {
        if (is_file($src . '/' . $f) && !copy($src . '/' . $f, $dstDir . '/' . $f)) die("复制失败: $f\n");
    }
    @chmod($dstDir . '/' . $f, 0644);
}

/* --- customJs：替换旧块 --- */
$loader = <<<'JS'
/* JG-TAGCLOUD3D-START */
(function () {
    var V = '2.2.1';
    if (!document.getElementById('jgtag3d-css')) {
        var l = document.createElement('link');
        l.id = 'jgtag3d-css'; l.rel = 'stylesheet';
        l.href = '/tagcloud3d/tagcloud3d.css?v=' + V;
        document.head.appendChild(l);
    }
    if (window.__jgTagCloud3DLoaded || document.getElementById('jgtag3d-js')) return;
    window.__jgTagCloud3DLoaded = true;
    var s = document.createElement('script');
    s.id = 'jgtag3d-js'; s.src = '/tagcloud3d/tagcloud3d.js?v=' + V;
    document.body.appendChild(s);
})();
/* JG-TAGCLOUD3D-END */
JS;

$js = isset($options['customJs']) ? $options['customJs'] : '';
$replaced = 0;
$js = preg_replace('~/\* JG-TAGCLOUD3D-START \*/.*?/\* JG-TAGCLOUD3D-END \*/\s*~s', '', $js, -1, $replaced);
$js = rtrim($js) . "\n\n" . $loader . "\n";
$options['customJs'] = $js;

$newValue = json_encode($options, JSON_UNESCAPED_UNICODE);
$st = $db->prepare("UPDATE typecho_options SET value=? WHERE name=?");
$st->bind_param('ss', $newValue, $optName);
if (!$st->execute()) die("写入失败: " . $st->error . "\n");
$st->close();

/* --- 回读校验 --- */
$v = $db->query("SELECT value FROM typecho_options WHERE name='" . $db->real_escape_string($optName) . "'")->fetch_assoc()['value'];
$o = json_decode($v, true);
$checks = array();
foreach (array('JG-WEATHER', 'JG-AI', 'JG-CARD-NOLOGO', 'JG-TC-FOOTER', 'JG-SIDEBAR-POMO', 'JG-ASIDE-ADS', 'JG-TAGCLOUD3D') as $k) {
    $checks[$k] = substr_count($v, $k);
}
echo json_encode(array(
    'ok' => true,
    'backup' => $bak,
    'fields_before' => $beforeCount,
    'fields_after' => count($o),
    'old_block_replaced' => $replaced,
    'customJs_len' => strlen($o['customJs']),
    'customCss_unchanged' => ($o['customCss'] === $options['customCss']),
    'blocks' => $checks,
    'files' => array($dstDir . '/tagcloud3d.js', $dstDir . '/tagcloud3d.css'),
), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . "\n";
