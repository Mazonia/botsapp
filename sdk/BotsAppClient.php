<?php

namespace App\Services;

use Exception;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * BotsAppClient - Enterprise Standalone WhatsApp Gateway Client for Laravel / PHP
 *
 * Provides a drop-in integration with the BotsApp Gateway service.
 * Supports standard text, media, location, polls, receipts, and diagnostics.
 */
class BotsAppClient
{
    private string $baseUrl;
    private ?string $apiKey;
    private int $timeout;

    public function __construct(?string $baseUrl = null, ?string $apiKey = null, int $timeout = 60)
    {
        $this->baseUrl = rtrim($baseUrl ?: config('services.whatsapp.bot_url', 'http://127.0.0.1:3001'), '/');
        $this->apiKey = $apiKey ?: config('services.whatsapp.api_key', null);
        $this->timeout = $timeout;
    }

    /**
     * Send a standard text message (queued through anti-ban protection).
     *
     * @param string $to Phone number (e.g. 024XXXXXXX or 233XXXXXXXX)
     * @param string $message Text content (supports *bold*, _italic_, etc.)
     * @param string $priority 'normal' or 'high' (for OTPs/urgent alerts)
     * @return array{success: bool, message: string, message_id?: string, daily_count?: int, error?: string}
     */
    public function sendMessage(string $to, string $message, string $priority = 'normal'): array
    {
        return $this->post('/api/send', [
            'phone' => $to,
            'message' => $message,
            'priority' => $priority,
        ]);
    }

    /**
     * Send rich media (Image, Video, Audio/Voice Note, or PDF/Document).
     *
     * @param string $to Phone number
     * @param string $mediaPathOrUrl Local absolute file path or public web URL
     * @param string $caption Text caption
     * @param bool $isVoice Send as WhatsApp voice note (PTT)
     * @param string|null $filename Custom document file name
     */
    public function sendMedia(
        string $to,
        string $mediaPathOrUrl,
        string $caption = '',
        bool $isVoice = false,
        ?string $filename = null
    ): array {
        if (filter_var($mediaPathOrUrl, FILTER_VALIDATE_URL)) {
            return $this->post('/api/messages/media', [
                'phone' => $to,
                'mediaUrl' => $mediaPathOrUrl,
                'caption' => $caption,
                'isVoice' => $isVoice,
                'filename' => $filename,
            ]);
        }

        if (! file_exists($mediaPathOrUrl)) {
            return ['success' => false, 'message' => "Local file not found: {$mediaPathOrUrl}"];
        }

        try {
            $req = Http::timeout($this->timeout);
            if ($this->apiKey) {
                $req->withHeaders(['X-Api-Key' => $this->apiKey]);
            }

            $response = $req->attach('file', fopen($mediaPathOrUrl, 'r'), basename($mediaPathOrUrl))
                ->post("{$this->baseUrl}/api/messages/media", [
                    'phone' => $to,
                    'caption' => $caption,
                    'isVoice' => $isVoice ? 'true' : 'false',
                    'filename' => $filename ?: basename($mediaPathOrUrl),
                ]);

            return $response->json() ?? ['success' => false, 'message' => 'Empty response from gateway'];
        } catch (Exception $e) {
            return ['success' => false, 'message' => 'Media upload failed: '.$e->getMessage()];
        }
    }

    /**
     * Send a WhatsApp location pin.
     */
    public function sendLocation(string $to, float $latitude, float $longitude, string $description = ''): array
    {
        return $this->post('/api/messages/location', [
            'phone' => $to,
            'latitude' => $latitude,
            'longitude' => $longitude,
            'description' => $description,
        ]);
    }

    /**
     * Send an interactive WhatsApp Poll.
     *
     * @param array<int, string> $options Minimum 2 options
     */
    public function sendPoll(string $to, string $title, array $options, bool $allowMultiple = false): array
    {
        return $this->post('/api/messages/poll', [
            'phone' => $to,
            'title' => $title,
            'options' => $options,
            'allowMultiple' => $allowMultiple,
        ]);
    }

    /**
     * Check if a phone number is registered on WhatsApp.
     */
    public function checkNumber(string $phone): array
    {
        return $this->post('/api/check-number', ['phone' => $phone]);
    }

    /**
     * Check live message ACK / delivery status.
     */
    public function checkMessageStatus(string $phone, ?string $messageId = null): array
    {
        return $this->post('/api/message-status', [
            'phone' => $phone,
            'message_id' => $messageId,
        ]);
    }

    /**
     * Batch check multiple notification delivery statuses.
     *
     * @param array<int, array{id: string, phone: string, message_id?: string}> $items
     */
    public function syncStatuses(array $items): array
    {
        $res = $this->post('/api/sync-statuses', ['items' => $items]);
        return $res['results'] ?? [];
    }

    /**
     * Check device health and authentication status.
     */
    public function checkStatus(): array
    {
        try {
            $req = Http::timeout(3);
            if ($this->apiKey) {
                $req->withHeaders(['X-Api-Key' => $this->apiKey]);
            }
            $response = $req->get("{$this->baseUrl}/api/status");
            return $response->json() ?? ['online' => false, 'authenticated' => false];
        } catch (Exception $e) {
            return [
                'online' => false,
                'authenticated' => false,
                'message' => 'BotsApp Gateway offline: '.$e->getMessage(),
            ];
        }
    }

    /**
     * Fetch latest QR code data URL.
     */
    public function getQrData(): array
    {
        try {
            $req = Http::timeout(3);
            if ($this->apiKey) {
                $req->withHeaders(['X-Api-Key' => $this->apiKey]);
            }
            $response = $req->get("{$this->baseUrl}/api/qr");
            return $response->json() ?? ['success' => false, 'qr' => null];
        } catch (Exception $e) {
            return ['success' => false, 'qr' => null, 'message' => $e->getMessage()];
        }
    }

    /**
     * Request session reset and fresh QR code.
     */
    public function resetSession(): array
    {
        return $this->post('/api/reset', []);
    }

    /**
     * Helper POST request.
     */
    private function post(string $endpoint, array $data): array
    {
        try {
            $req = Http::timeout($this->timeout);
            if ($this->apiKey) {
                $req->withHeaders(['X-Api-Key' => $this->apiKey]);
            }
            $response = $req->post("{$this->baseUrl}{$endpoint}", $data);
            return $response->json() ?? ['success' => false, 'message' => 'Empty response from gateway'];
        } catch (Exception $e) {
            Log::warning("BotsApp Client POST {$endpoint} failed: {$e->getMessage()}");
            return [
                'success' => false,
                'message' => 'Gateway request failed: '.$e->getMessage(),
            ];
        }
    }
}
