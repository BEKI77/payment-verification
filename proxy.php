<?php
/**
 * Telebirr / CBE Receipt Proxy (PHP version)
 *
 * Upload this single file to any Ethiopian cPanel hosting.
 * It fetches receipts from Ethio Telecom / CBE and returns JSON shaped
 * the same way as the NestJS API's responses.
 *
 * Usage:
 *   Telebirr: https://your-host.com/proxy.php?reference=DBA3NNHH03
 *             https://your-host.com/proxy.php?type=telebirr&reference=DBA3NNHH03
 *   CBE (new receipt token only):
 *             https://your-host.com/proxy.php?type=cbe&reference=v1-abc123...
 * Header required: x-proxy-secret: your-secret-here
 */

// ============ CONFIGURATION ============
$PROXY_SECRET = 'boss2026SecureProxy!';  // Change this!
$CBE_APP_ID = 'd1292e42-7400-49de-a2d3-9731caa4c819';
$CBE_APP_VERSION = '0a01980b-9859-1369-8198-59f403820000';
// ========================================

header('Content-Type: application/json');

function respond($statusCode, $payload) {
    http_response_code($statusCode);
    echo json_encode($payload);
    exit;
}

// Check secret
$providedSecret = $_SERVER['HTTP_X_PROXY_SECRET'] ?? '';
if ($providedSecret !== $PROXY_SECRET) {
    respond(401, ['success' => false, 'error' => 'Unauthorized']);
}

// Get reference / type
$type = strtolower(trim($_GET['type'] ?? 'telebirr'));
$reference = $_GET['reference'] ?? '';

if (empty($reference) || strlen($reference) < 4) {
    respond(400, ['success' => false, 'error' => 'Invalid or missing reference']);
}

if ($type === 'cbe') {
    handleCbeRequest($reference, $CBE_APP_ID, $CBE_APP_VERSION);
} else {
    handleTelebirrRequest($reference);
}

// ============ SHARED HTTP HELPER ============

function httpGet($url, $headers = [], $timeout = 15) {
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_SSL_VERIFYPEER => false,
    ]);
    $body = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    return [$body, $httpCode, $error];
}

// ==================================================================
// ============ TELEBIRR ============================================
// ==================================================================

function handleTelebirrRequest($reference) {
    // Sanitize reference (only allow alphanumeric)
    $reference = preg_replace('/[^a-zA-Z0-9]/', '', $reference);
    $url = 'https://transactioninfo.ethiotelecom.et/receipt/' . urlencode($reference);

    [$response, $httpCode, $error] = httpGet($url, [
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language: en-US,en;q=0.9',
    ], 15);

    if ($error) {
        respond(500, ['success' => false, 'error' => 'Failed to fetch receipt: ' . $error]);
    }
    if ($httpCode === 404) {
        respond(404, ['success' => false, 'error' => 'Receipt not found']);
    }
    if ($httpCode !== 200) {
        respond(500, ['success' => false, 'error' => "Ethio Telecom returned HTTP $httpCode"]);
    }

    // Some upstream/proxy sources return already-shaped JSON; pass it through if so.
    $jsonData = json_decode($response, true);
    if ($jsonData !== null) {
        $mapped = mapTelebirrJson($jsonData);
        if ($mapped !== null) {
            respond(200, ['success' => true, 'data' => $mapped]);
        }
    }

    $receipt = scrapeTelebirrReceipt($response);
    respond(200, ['success' => true, 'data' => $receipt]);
}

function telebirrReceiptShape($data) {
    return [
        'payerName' => $data['payerName'] ?? '',
        'payerTelebirrNo' => $data['payerTelebirrNo'] ?? '',
        'creditedPartyName' => $data['creditedPartyName'] ?? '',
        'creditedPartyAccountNo' => $data['creditedPartyAccountNo'] ?? '',
        'transactionStatus' => $data['transactionStatus'] ?? '',
        'receiptNo' => $data['receiptNo'] ?? '',
        'paymentDate' => $data['paymentDate'] ?? '',
        'settledAmount' => $data['settledAmount'] ?? '',
        'serviceFee' => $data['serviceFee'] ?? '',
        'serviceFeeVAT' => $data['serviceFeeVAT'] ?? '',
        'totalPaidAmount' => $data['totalPaidAmount'] ?? '',
        'bankName' => $data['bankName'] ?? '',
    ];
}

function mapTelebirrJson($jsonData) {
    if (!is_array($jsonData)) return null;

    if (isset($jsonData['amount']) && array_key_exists('message', $jsonData)) {
        return telebirrReceiptShape([
            'transactionStatus' => 'Completed',
            'settledAmount' => $jsonData['amount'],
            'totalPaidAmount' => $jsonData['amount'],
        ]);
    }

    if (empty($jsonData['success']) || empty($jsonData['data'])) return null;
    return telebirrReceiptShape($jsonData['data']);
}

// ---- regex extractors (ported from the NestJS TelebirrVerifier) ----

function extractSettledAmountRegex($html) {
    if (preg_match('/የተከፈለው\s+መጠን\/Settled\s+Amount.*?<\/td>\s*<td[^>]*>\s*(\d+(?:\.\d{2})?\s+Birr)/is', $html, $m)) {
        return trim($m[1]);
    }
    if (preg_match('/<tr[^>]*>.*?የተከፈለው\s+መጠን\/Settled\s+Amount.*?<td[^>]*>\s*(\d+(?:\.\d{2})?\s+Birr)/is', $html, $m)) {
        return trim($m[1]);
    }
    if (preg_match('/Settled\s+Amount.*?(\d+(?:\.\d{2})?\s+Birr)/is', $html, $m)) {
        return trim($m[1]);
    }
    if (preg_match('/የክፍያ\s+ዝርዝር\/Transaction\s+details.*?<tr[^>]*>.*?<td[^>]*>\s*[^<]*<\/td>\s*<td[^>]*>\s*[^<]*<\/td>\s*<td[^>]*>\s*(\d+(?:\.\d{2})?\s+Birr)/is', $html, $m)) {
        return trim($m[1]);
    }
    return null;
}

function extractServiceFeeRegex($html) {
    if (preg_match('/የአገልግሎት\s+ክፍያ\/Service\s+fee(?!\s+ተ\.እ\.ታ).*?<\/td>\s*<td[^>]*>\s*(\d+(?:\.\d{2})?\s+Birr)/is', $html, $m)) {
        return trim($m[1]);
    }
    return null;
}

function extractReceiptNoRegex($html) {
    if (preg_match('/<td[^>]*class="[^"]*receipttableTd[^"]*receipttableTd2[^"]*"[^>]*>\s*([A-Z0-9]+)\s*<\/td>/i', $html, $m)) {
        return trim($m[1]);
    }
    return null;
}

function extractDateRegex($html) {
    if (preg_match('/(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2})/', $html, $m)) {
        return trim($m[1]);
    }
    return null;
}

function extractWithRegex($html, $labelPattern, $valuePattern = '([^<]+)') {
    $escapedLabel = preg_quote($labelPattern, '/');
    if (preg_match('/' . $escapedLabel . '.*?<\/td>\s*<td[^>]*>\s*' . $valuePattern . '/is', $html, $m)) {
        return trim(strip_tags($m[1]));
    }
    return null;
}

// ---- DOM fallback helpers (mirrors the cheerio fallback paths) ----

function loadHtmlDom($html) {
    $dom = new DOMDocument();
    libxml_use_internal_errors(true);
    $dom->loadHTML('<?xml encoding="utf-8" ?>' . $html);
    libxml_clear_errors();
    return $dom;
}

function domNextTdText(DOMXPath $xpath, $labelText) {
    $tds = $xpath->query('//td');
    foreach ($tds as $td) {
        if (mb_stripos($td->textContent, $labelText) !== false) {
            $next = $xpath->query('following-sibling::td[1]', $td)->item(0);
            if ($next) return trim($next->textContent);
        }
    }
    return '';
}

function domGetPaymentDateFallback(DOMXPath $xpath) {
    $nodes = $xpath->query('//*[contains(concat(" ", normalize-space(@class), " "), " receipttableTd ")]');
    foreach ($nodes as $node) {
        if (mb_strpos($node->textContent, '-202') !== false) {
            return trim($node->textContent);
        }
    }
    return '';
}

function domGetReceiptNoFallback(DOMXPath $xpath) {
    $nodes = $xpath->query('//td[contains(concat(" ", normalize-space(@class), " "), " receipttableTd ") and contains(concat(" ", normalize-space(@class), " "), " receipttableTd2 ")]');
    if ($nodes->length > 1) {
        return trim($nodes->item(1)->textContent);
    }
    return '';
}

function domGetSettledAmountFallback(DOMXPath $xpath) {
    $nodes = $xpath->query('//td[contains(concat(" ", normalize-space(@class), " "), " receipttableTd ") and contains(concat(" ", normalize-space(@class), " "), " receipttableTd2 ")]');
    foreach ($nodes as $node) {
        $prev = $xpath->query('preceding-sibling::td[1]', $node)->item(0);
        if ($prev && (mb_strpos($prev->textContent, 'የተከፈለው መጠን') !== false || mb_strpos($prev->textContent, 'Settled Amount') !== false)) {
            return trim($node->textContent);
        }
    }
    $rows = $xpath->query('//tr');
    foreach ($rows as $row) {
        $firstTd = $xpath->query('.//td[1]', $row)->item(0);
        if ($firstTd && (mb_strpos($firstTd->textContent, 'የተከፈለው መጠን') !== false || mb_strpos($firstTd->textContent, 'Settled Amount') !== false)) {
            $tds = $xpath->query('.//td', $row);
            if ($tds->length > 0) return trim($tds->item($tds->length - 1)->textContent);
        }
    }
    return '';
}

function domGetServiceFeeFallback(DOMXPath $xpath) {
    $nodes = $xpath->query('//td[contains(concat(" ", normalize-space(@class), " "), " receipttableTd1 ")]');
    foreach ($nodes as $node) {
        $text = $node->textContent;
        if ((mb_strpos($text, 'የአገልግሎት ክፍያ') !== false || mb_strpos($text, 'Service fee') !== false)
            && mb_strpos($text, 'ተ.እ.ታ') === false && mb_strpos($text, 'VAT') === false) {
            $next = $xpath->query('following-sibling::td[contains(concat(" ", normalize-space(@class), " "), " receipttableTd ") and contains(concat(" ", normalize-space(@class), " "), " receipttableTd2 ")][1]', $node)->item(0);
            if ($next) return trim($next->textContent);
        }
    }
    $rows = $xpath->query('//tr');
    foreach ($rows as $row) {
        $text = $row->textContent;
        if ((mb_strpos($text, 'የአገልግሎት ክፍያ') !== false || mb_strpos($text, 'Service fee') !== false)
            && mb_strpos($text, 'ተ.እ.ታ') === false && mb_strpos($text, 'VAT') === false) {
            $tds = $xpath->query('.//td', $row);
            if ($tds->length > 0) return trim($tds->item($tds->length - 1)->textContent);
        }
    }
    return '';
}

function scrapeTelebirrReceipt($html) {
    $dom = loadHtmlDom($html);
    $xpath = new DOMXPath($dom);

    $getTextWithFallback = function ($labelText) use ($html, $xpath) {
        $regexResult = extractWithRegex($html, $labelText);
        if ($regexResult !== null && $regexResult !== '') return $regexResult;
        return domNextTdText($xpath, $labelText);
    };

    $getPaymentDate = function () use ($html, $xpath) {
        $regexDate = extractDateRegex($html);
        if ($regexDate) return $regexDate;
        return domGetPaymentDateFallback($xpath);
    };

    $getReceiptNo = function () use ($html, $xpath) {
        $regexReceiptNo = extractReceiptNoRegex($html);
        if ($regexReceiptNo) return $regexReceiptNo;
        return domGetReceiptNoFallback($xpath);
    };

    $getSettledAmount = function () use ($html, $xpath) {
        $regexAmount = extractSettledAmountRegex($html);
        if ($regexAmount) return $regexAmount;
        return domGetSettledAmountFallback($xpath);
    };

    $getServiceFee = function () use ($html, $xpath) {
        $regexFee = extractServiceFeeRegex($html);
        if ($regexFee) return $regexFee;
        return domGetServiceFeeFallback($xpath);
    };

    $creditedPartyName = $getTextWithFallback('የገንዘብ ተቀባይ ስም/Credited Party name');
    $creditedPartyAccountNo = $getTextWithFallback('የገንዘብ ተቀባይ ቴሌብር ቁ./Credited party account no');
    $bankName = '';

    $bankAccountNumberRaw = $getTextWithFallback('የባንክ አካውንት ቁጥር/Bank account number');
    if (!empty($bankAccountNumberRaw)) {
        $bankName = $creditedPartyName;
        if (preg_match('/(\d+)\s+(.*)/', $bankAccountNumberRaw, $m)) {
            $creditedPartyAccountNo = trim($m[1]);
            $creditedPartyName = trim($m[2]);
        }
    }

    return [
        'payerName' => $getTextWithFallback('የከፋይ ስም/Payer Name'),
        'payerTelebirrNo' => $getTextWithFallback('የከፋይ ቴሌብር ቁ./Payer telebirr no.'),
        'creditedPartyName' => $creditedPartyName,
        'creditedPartyAccountNo' => $creditedPartyAccountNo,
        'transactionStatus' => $getTextWithFallback('የክፍያው ሁኔታ/transaction status'),
        'receiptNo' => $getReceiptNo(),
        'paymentDate' => $getPaymentDate(),
        'settledAmount' => $getSettledAmount(),
        'serviceFee' => $getServiceFee(),
        'serviceFeeVAT' => $getTextWithFallback('የአገልግሎት ክፍያ ተ.እ.ታ/Service fee VAT'),
        'totalPaidAmount' => $getTextWithFallback('ጠቅላላ የተከፈለ/Total Paid Amount'),
        'bankName' => $bankName,
    ];
}

// ==================================================================
// ============ CBE (new receipt token only) ========================
// ==================================================================
//
// NOTE: This proxy only supports the "new" CBE receipt token format
// (the one behind https://mbreciept.cbe.com.et/<token>), which is a
// simple JSON API. The legacy `FT...` + account-suffix flow requires
// downloading and parsing a PDF receipt, which this lightweight proxy
// does not implement.

function extractNewCbeToken($input) {
    $trimmed = trim($input);
    if (preg_match('/^https?:\/\/mbreciept\.cbe\.com\.et\/((?:v\d+-)?[A-Za-z0-9]+)\/?$/i', $trimmed, $m)) {
        return $m[1];
    }
    if (stripos($trimmed, 'FT') !== 0 && preg_match('/^(?:v\d+-)?[A-Za-z0-9]{15,25}$/', $trimmed)) {
        return $trimmed;
    }
    return null;
}

function isLegacyCbeReference($reference) {
    return strlen($reference) === 12 && stripos($reference, 'FT') === 0;
}

function toIsoDate($value) {
    if (empty($value)) return null;
    $ts = strtotime($value);
    if ($ts === false) return $value;
    return gmdate('Y-m-d\TH:i:s', $ts) . '.000Z';
}

function mapNewCbeReceipt($data) {
    $amount = null;
    if (isset($data['amountCredited']) && is_numeric($data['amountCredited'])) {
        $amount = floatval($data['amountCredited']);
    }

    $date = null;
    if (!empty($data['dateTimes'][0])) {
        $date = toIsoDate($data['dateTimes'][0]);
    }

    $reason = null;
    if (!empty($data['paymentDetails']) && is_array($data['paymentDetails'])) {
        $reason = implode(' ', $data['paymentDetails']);
    }

    return [
        'success' => true,
        'payer' => $data['debitAccountHolder'] ?? null,
        'payerAccount' => $data['debitAccountNo'] ?? null,
        'receiver' => $data['creditAccountHolder'] ?? null,
        'receiverAccount' => $data['creditAccountNo'] ?? null,
        'amount' => $amount,
        'date' => $date,
        'reference' => $data['id'] ?? null,
        'reason' => $reason,
    ];
}

function handleCbeRequest($reference, $appId, $appVersion) {
    $reference = trim($reference);
    $token = extractNewCbeToken($reference);

    if ($token === null) {
        if (isLegacyCbeReference($reference)) {
            respond(400, [
                'success' => false,
                'error' => 'Legacy FT + account-suffix CBE references are not supported by this proxy; only new-style receipt tokens are supported.',
            ]);
        }
        respond(400, ['success' => false, 'error' => 'Invalid CBE reference format.']);
    }

    $url = "https://mb.cbe.com.et/api/v1/transactions/public/transaction-detail/$token";
    [$response, $httpCode, $error] = httpGet($url, [
        'Accept: application/json, text/plain, */*',
        'Origin: https://mbreciept.cbe.com.et',
        'Referer: https://mbreciept.cbe.com.et/',
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        "x-app-id: $appId",
        "x-app-version: $appVersion",
    ], 15);

    if ($error) {
        respond(500, ['success' => false, 'error' => 'New CBE verification failed: ' . $error]);
    }
    if ($httpCode === 404) {
        respond(404, ['success' => false, 'error' => 'Invalid or expired CBE receipt token.']);
    }
    if ($httpCode !== 200) {
        respond(500, ['success' => false, 'error' => "New CBE verification failed: HTTP $httpCode"]);
    }

    $data = json_decode($response, true);
    if ($data === null) {
        respond(500, ['success' => false, 'error' => 'New CBE verification failed: invalid JSON response']);
    }

    $result = mapNewCbeReceipt($data);
    respond(200, ['success' => true, 'data' => $result]);
}
