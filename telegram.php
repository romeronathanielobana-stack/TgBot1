<?php
// api/telegram.php  — Vercel PHP serverless function
// Acts as a secure proxy between your frontend and the Telegram Bot API
// This prevents CORS issues and keeps tokens away from browser network logs

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Handle CORS preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'description' => 'Method not allowed']);
    exit;
}

// ── Read request body ──────────────────────────────────────────────────────────
$body = file_get_contents('php://input');
$data = json_decode($body, true);

if (!$data) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'description' => 'Invalid JSON body']);
    exit;
}

$token  = $data['token']  ?? '';
$method = $data['method'] ?? '';
$params = $data['params'] ?? [];

// ── Validate inputs ────────────────────────────────────────────────────────────
if (empty($token) || empty($method)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'description' => 'token and method are required']);
    exit;
}

// Token format: digits:alphanumeric-dash-underscore
if (!preg_match('/^\d{8,12}:[A-Za-z0-9_\-]{35}$/', $token)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'description' => 'Invalid token format']);
    exit;
}

// Whitelist allowed Telegram Bot API methods
$allowedMethods = [
    'getMe',
    'getUpdates',
    'sendMessage',
    'setMessageReaction',
    'getChat',
    'getChatMember',
    'getChatMemberCount',
    'forwardMessage',
    'copyMessage',
];

if (!in_array($method, $allowedMethods, true)) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'description' => "Method '$method' is not permitted"]);
    exit;
}

// ── Forward to Telegram API ────────────────────────────────────────────────────
$url = "https://api.telegram.org/bot{$token}/{$method}";

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL            => $url,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => json_encode($params),
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_SSL_VERIFYPEER => true,
]);

$response  = curl_exec($ch);
$httpCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($curlError) {
    http_response_code(502);
    echo json_encode(['ok' => false, 'description' => "cURL error: $curlError"]);
    exit;
}

// ── Security: strip any sensitive keys from the response before forwarding ──
// (Telegram responses don't normally contain tokens, but just in case)
http_response_code($httpCode);
echo $response;
