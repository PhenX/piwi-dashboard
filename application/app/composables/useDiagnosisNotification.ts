import type { FailureDiagnosis } from '~~/server/database/schema';

const STORAGE_KEY = 'piwi-diagnosis-notifications';

export interface DiagnosisNotificationPayload {
  clusterId: number;
  summary?: string | null;
  rootCause?: string | null;
  category?: string | null;
  confidence?: string | null;
}

export function useDiagnosisNotification() {
  const permission = ref<NotificationPermission>('default');
  const notifiedIds = new Set<number>();

  const enabled = ref(true);

  if (import.meta.client) {
    if ('Notification' in window) {
      permission.value = Notification.permission;
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'false') enabled.value = false;
  }

  const supported = computed(() => import.meta.client && 'Notification' in window);

  const active = computed(() => supported.value && permission.value === 'granted' && enabled.value);

  async function requestPermission() {
    if (!supported.value) return;
    const result = await Notification.requestPermission();
    permission.value = result;
  }

  function toggleEnabled() {
    enabled.value = !enabled.value;
    localStorage.setItem(STORAGE_KEY, String(enabled.value));
  }

  function notify(diagnosis: FailureDiagnosis, clusterId: number) {
    notifyFromPayload({
      clusterId,
      summary: diagnosis.summary,
      rootCause: diagnosis.rootCause,
      category: diagnosis.category,
      confidence: diagnosis.confidence,
    });
  }

  function notifyFromPayload(payload: DiagnosisNotificationPayload) {
    if (!active.value) return;
    if (notifiedIds.has(payload.clusterId)) return;

    const lines = [payload.summary || payload.rootCause];
    if (payload.category) lines.push(`Category: ${payload.category}`);
    if (payload.confidence) lines.push(`Confidence: ${payload.confidence}`);
    const body = lines.join('\n');
    if (!body) return;

    const notification = new Notification('Piwi diagnosis complete', {
      body,
      tag: `diagnosis-${payload.clusterId}`,
      icon: '/favicon.ico',
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };

    notifiedIds.add(payload.clusterId);
  }

  return { permission, supported, active, requestPermission, toggleEnabled, notify, notifyFromPayload };
}
