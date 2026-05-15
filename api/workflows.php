<?php
require_once __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');

$method = $_SERVER['REQUEST_METHOD'];

// ─── GET ────────────────────────────────────────────────────────────────────
if ($method === 'GET') {
    $db  = getDB();
    $id  = $_GET['id'] ?? null;
    $all = isset($_GET['withData']); // ?withData=1 carga datos completos

    if ($id) {
        // Workflow individual con datos
        $stmt = $db->prepare('SELECT * FROM workflows WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) jsonError('Not found', 404);
        jsonOut(rowToWf($row));
    } else {
        // Lista — con ?withData se incluye el campo data (para precarga al arrancar)
        $sql = $all
            ? 'SELECT * FROM workflows ORDER BY updated_at DESC'
            : 'SELECT id, name, description, created_at, updated_at FROM workflows ORDER BY updated_at DESC';
        $rows = $db->query($sql)->fetchAll();
        jsonOut(array_map('rowToWf', $rows));
    }
}

// ─── POST (create, save, rename, setDescription, duplicate) ─────────────────
if ($method === 'POST') {
    $db   = getDB();
    $body = getBody();
    $action = $body['action'] ?? 'create';

    switch ($action) {
        case 'create': {
            $id   = $body['id']          ?? ('wf-' . bin2hex(random_bytes(8)));
            $name = trim($body['name']   ?? 'Sin nombre') ?: 'Sin nombre';
            $desc = $body['description'] ?? '';
            $data = json_encode($body['data'] ?? ['nodes' => [], 'connections' => [], 'nextId' => 1]);
            $now  = $body['createdAt']   ?? (int)(microtime(true) * 1000);
            $upd  = $body['updatedAt']   ?? $now;

            $db->prepare('INSERT INTO workflows (id, name, description, data, created_at, updated_at) VALUES (?,?,?,?,?,?)')
               ->execute([$id, $name, $desc, $data, $now, $upd]);

            $stmt = $db->prepare('SELECT * FROM workflows WHERE id = ?');
            $stmt->execute([$id]);
            jsonOut(rowToWf($stmt->fetch()));
        }

        case 'save': {
            $id  = $body['id']  ?? null;
            $upd = $body['updatedAt'] ?? (int)(microtime(true) * 1000);
            if (!$id) jsonError('Missing id');
            $data = json_encode($body['data'] ?? []);
            $db->prepare('UPDATE workflows SET data = ?, updated_at = ? WHERE id = ?')
               ->execute([$data, $upd, $id]);
            jsonOut(['ok' => true]);
        }

        case 'rename': {
            $id   = $body['id']   ?? null;
            $name = trim($body['name'] ?? '') ?: 'Sin nombre';
            $upd  = $body['updatedAt'] ?? (int)(microtime(true) * 1000);
            if (!$id) jsonError('Missing id');
            $db->prepare('UPDATE workflows SET name = ?, updated_at = ? WHERE id = ?')
               ->execute([$name, $upd, $id]);
            jsonOut(['ok' => true]);
        }

        case 'setDescription': {
            $id   = $body['id']          ?? null;
            $desc = $body['description'] ?? '';
            $upd  = $body['updatedAt']   ?? (int)(microtime(true) * 1000);
            if (!$id) jsonError('Missing id');
            $db->prepare('UPDATE workflows SET description = ?, updated_at = ? WHERE id = ?')
               ->execute([$desc, $upd, $id]);
            jsonOut(['ok' => true]);
        }

        case 'duplicate': {
            $id = $body['id'] ?? null;
            if (!$id) jsonError('Missing id');
            $stmt = $db->prepare('SELECT * FROM workflows WHERE id = ?');
            $stmt->execute([$id]);
            $orig = $stmt->fetch();
            if (!$orig) jsonError('Original not found', 404);
            $newId = 'wf-' . bin2hex(random_bytes(8));
            $now   = (int)(microtime(true) * 1000);
            $db->prepare('INSERT INTO workflows (id, name, description, data, created_at, updated_at) VALUES (?,?,?,?,?,?)')
               ->execute([$newId, $orig['name'] . ' (copia)', $orig['description'], $orig['data'], $now, $now]);
            $stmt2 = $db->prepare('SELECT * FROM workflows WHERE id = ?');
            $stmt2->execute([$newId]);
            jsonOut(rowToWf($stmt2->fetch()));
        }

        default:
            jsonError('Unknown action: ' . $action);
    }
}

// ─── DELETE ──────────────────────────────────────────────────────────────────
if ($method === 'DELETE') {
    $id = $_GET['id'] ?? null;
    if (!$id) jsonError('Missing id');
    $db = getDB();

    // Borrar todos los runs y sus ficheros
    $stmt = $db->prepare('SELECT id FROM runs WHERE workflow_id = ?');
    $stmt->execute([$id]);
    foreach ($stmt->fetchAll() as $run) {
        $dir = STORAGE_ROOT . '/' . $run['id'];
        deleteDir($dir);
    }
    $db->prepare('DELETE FROM runs WHERE workflow_id = ?')->execute([$id]);
    $db->prepare('DELETE FROM workflows WHERE id = ?')->execute([$id]);

    jsonOut(['ok' => true, 'deleted' => $id]);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function rowToWf(array $row): array {
    $out = [
        'id'          => $row['id'],
        'name'        => $row['name'],
        'description' => $row['description'] ?? '',
        'createdAt'   => (int)($row['created_at'] ?? 0),
        'updatedAt'   => (int)($row['updated_at'] ?? 0),
    ];
    if (isset($row['data'])) {
        $out['data'] = json_decode($row['data'], true) ?? [];
    }
    return $out;
}
