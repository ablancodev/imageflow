<?php
require_once __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');

$method = $_SERVER['REQUEST_METHOD'];

// ─── GET — lista de runs de un workflow ──────────────────────────────────────
if ($method === 'GET') {
    $workflowId = $_GET['workflow_id'] ?? null;
    if (!$workflowId) jsonError('Missing workflow_id');

    $db   = getDB();
    $stmt = $db->prepare(
        'SELECT * FROM runs WHERE workflow_id = ? ORDER BY created_at DESC LIMIT ' . MAX_RUNS_PER_WORKFLOW
    );
    $stmt->execute([$workflowId]);
    $rows = $stmt->fetchAll();

    jsonOut(array_map('rowToRun', $rows));
}

// ─── POST ────────────────────────────────────────────────────────────────────
if ($method === 'POST') {
    $body   = getBody();
    $action = $body['action'] ?? 'save';

    if ($action === 'save') {
        $workflowId   = $body['workflowId']   ?? null;
        $workflowName = $body['workflowName'] ?? '';
        $durationMs   = (int)($body['durationMs'] ?? 0);
        $nodeResults  = $body['nodeResults']  ?? [];

        if (!$workflowId) jsonError('Missing workflowId');
        if (empty($nodeResults)) jsonError('No results to save');

        $db    = getDB();
        $runId = 'run-' . bin2hex(random_bytes(10));
        $now   = (int)(microtime(true) * 1000);

        // Crear directorio del run
        $runDir = STORAGE_ROOT . '/' . $runId;
        if (!is_dir($runDir)) mkdir($runDir, 0775, true);

        $resultCount    = 0;
        $thumbnailPath  = null;
        $storedResults  = []; // [{nodeId, type, filePaths, resultsMeta}]

        foreach ($nodeResults as $nr) {
            $nodeId      = preg_replace('/[^a-z0-9_\-]/i', '', $nr['nodeId'] ?? 'node');
            $nodeType    = $nr['type']        ?? 'unknown';
            $results     = $nr['results']     ?? [];
            $resultsMeta = $nr['resultsMeta'] ?? [];
            $filePaths   = [];

            foreach ($results as $i => $dataUrl) {
                $saved = saveDataUrl($dataUrl, $runDir, $nodeId, $i);
                if ($saved === null) continue;

                $relPath    = $runId . '/' . $saved['filename'];
                $filePaths[]= $relPath;

                // Primera imagen del nodo output (o la primera disponible) → thumbnail
                if ($thumbnailPath === null && $saved['type'] === 'image') {
                    if ($nodeType === 'output' || $thumbnailPath === null) {
                        $thumbnailPath = $relPath;
                    }
                }
                $resultCount++;
            }

            if (!empty($filePaths)) {
                $storedResults[] = [
                    'nodeId'      => $nr['nodeId'],
                    'type'        => $nodeType,
                    'filePaths'   => $filePaths,
                    'resultsMeta' => $resultsMeta,
                ];
            }
        }

        // Buscar thumbnail en output si no se asignó aún
        if ($thumbnailPath === null && !empty($storedResults)) {
            foreach ($storedResults as $sr) {
                if ($sr['type'] === 'output' && !empty($sr['filePaths'])) {
                    $thumbnailPath = $sr['filePaths'][0]; break;
                }
            }
            if ($thumbnailPath === null) {
                $thumbnailPath = $storedResults[0]['filePaths'][0] ?? null;
            }
        }

        $nodeResultsJson = json_encode($storedResults, JSON_UNESCAPED_SLASHES);

        $db->prepare(
            'INSERT INTO runs (id, workflow_id, workflow_name, created_at, duration_ms, result_count, thumbnail_path, node_results_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([$runId, $workflowId, $workflowName, $now, $durationMs, $resultCount, $thumbnailPath, $nodeResultsJson]);

        // Podar runs antiguos
        pruneOldRuns($db, $workflowId);

        jsonOut([
            'id'           => $runId,
            'workflowId'   => $workflowId,
            'workflowName' => $workflowName,
            'createdAt'    => $now,
            'durationMs'   => $durationMs,
            'resultCount'  => $resultCount,
            'thumbnail'    => $thumbnailPath ? STORAGE_URL . '/' . $thumbnailPath : null,
        ]);
    }

    if ($action === 'deleteWorkflow') {
        $workflowId = $body['workflowId'] ?? null;
        if (!$workflowId) jsonError('Missing workflowId');
        deleteWorkflowRuns(getDB(), $workflowId);
        jsonOut(['ok' => true]);
    }

    jsonError('Unknown action');
}

// ─── DELETE — un run ─────────────────────────────────────────────────────────
if ($method === 'DELETE') {
    $id = $_GET['id'] ?? null;
    if (!$id) jsonError('Missing id');

    $db   = getDB();
    $stmt = $db->prepare('SELECT id FROM runs WHERE id = ?');
    $stmt->execute([$id]);
    $run = $stmt->fetch();
    if ($run) {
        deleteDir(STORAGE_ROOT . '/' . $id);
        $db->prepare('DELETE FROM runs WHERE id = ?')->execute([$id]);
    }
    jsonOut(['ok' => true]);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function saveDataUrl(string $dataUrl, string $dir, string $nodeId, int $index): ?array {
    if (!preg_match('/^data:([\w\/\+]+);base64,(.+)$/s', $dataUrl, $m)) return null;
    $mime   = $m[1];
    $binary = base64_decode($m[2], true);
    if ($binary === false) return null;

    $extMap = [
        'image/png'  => 'png',
        'image/jpeg' => 'jpg',
        'image/jpg'  => 'jpg',
        'image/webp' => 'webp',
        'image/gif'  => 'gif',
        'video/webm' => 'webm',
        'video/mp4'  => 'mp4',
    ];
    $ext  = $extMap[$mime] ?? 'bin';
    $type = str_starts_with($mime, 'video/') ? 'video' : 'image';

    $filename = $nodeId . '-' . $index . '.' . $ext;
    file_put_contents($dir . '/' . $filename, $binary);

    return ['filename' => $filename, 'type' => $type];
}

function rowToRun(array $row): array {
    $nodeResults = json_decode($row['node_results_json'], true) ?? [];

    // Convertir filePaths → results con URLs completas
    $nodeResultsOut = array_map(function (array $nr): array {
        return [
            'nodeId'      => $nr['nodeId'],
            'type'        => $nr['type'],
            'results'     => array_map(fn($p) => STORAGE_URL . '/' . $p, $nr['filePaths'] ?? []),
            'resultsMeta' => $nr['resultsMeta'] ?? [],
        ];
    }, $nodeResults);

    return [
        'id'           => $row['id'],
        'workflowId'   => $row['workflow_id'],
        'workflowName' => $row['workflow_name'],
        'createdAt'    => (int)$row['created_at'],
        'durationMs'   => (int)$row['duration_ms'],
        'resultCount'  => (int)$row['result_count'],
        'thumbnail'    => $row['thumbnail_path'] ? STORAGE_URL . '/' . $row['thumbnail_path'] : null,
        'nodeResults'  => $nodeResultsOut,
    ];
}

function pruneOldRuns(PDO $db, string $workflowId): void {
    $stmt = $db->prepare('SELECT id FROM runs WHERE workflow_id = ? ORDER BY created_at DESC');
    $stmt->execute([$workflowId]);
    $all = $stmt->fetchAll(PDO::FETCH_COLUMN);
    if (count($all) <= MAX_RUNS_PER_WORKFLOW) return;

    $toDelete = array_slice($all, MAX_RUNS_PER_WORKFLOW);
    $placeholders = implode(',', array_fill(0, count($toDelete), '?'));
    foreach ($toDelete as $id) {
        deleteDir(STORAGE_ROOT . '/' . $id);
    }
    $db->prepare("DELETE FROM runs WHERE id IN ($placeholders)")->execute($toDelete);
}

function deleteWorkflowRuns(PDO $db, string $workflowId): void {
    $stmt = $db->prepare('SELECT id FROM runs WHERE workflow_id = ?');
    $stmt->execute([$workflowId]);
    foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $id) {
        deleteDir(STORAGE_ROOT . '/' . $id);
    }
    $db->prepare('DELETE FROM runs WHERE workflow_id = ?')->execute([$workflowId]);
}
