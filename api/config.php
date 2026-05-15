<?php
// Configuración de la base de datos — ajusta si tu XAMPP usa credenciales distintas
define('DB_HOST', '127.0.0.1');
define('DB_PORT', 3306);
define('DB_NAME', 'imageflow');
define('DB_USER', 'root');
define('DB_PASS', '');

// Ruta absoluta del sistema de ficheros al directorio storage/runs/
define('STORAGE_ROOT', dirname(__DIR__) . '/storage/runs');

// URL pública relativa al servidor (sin trailing slash)
// Si tu app NO está en /imageflow/, ajusta esta constante
define('STORAGE_URL', '/imageflow/storage/runs');

define('MAX_RUNS_PER_WORKFLOW', 5);

function getDB(): PDO {
    static $pdo = null;
    if ($pdo !== null) return $pdo;
    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
                   DB_HOST, DB_PORT, DB_NAME);
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
    return $pdo;
}

function jsonOut(mixed $data, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function jsonError(string $msg, int $status = 400): never {
    jsonOut(['ok' => false, 'error' => $msg], $status);
}

function getBody(): array {
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    try {
        $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        return is_array($decoded) ? $decoded : [];
    } catch (JsonException) {
        return [];
    }
}

// Borrado recursivo de directorio
function deleteDir(string $dir): void {
    if (!is_dir($dir)) return;
    $items = scandir($dir);
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        $path = "$dir/$item";
        is_dir($path) ? deleteDir($path) : unlink($path);
    }
    rmdir($dir);
}
