import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Eraser, Send, X } from 'lucide-react';
import { z } from 'zod';
import { useTranslation } from '../i18n.js';

const ChatResponseSchema = z.object({
  answer: z.string(),
  citations: z.array(z.string()),
  sources: z.array(z.object({
    id: z.string(),
    title: z.string(),
    version: z.number().optional(),
  })),
  mode: z.enum(['live', 'cache']),
  fallback: z.boolean(),
  draftContent: z.boolean(),
  updatedAt: z.string().nullable(),
});

type ChatResponse = z.infer<typeof ChatResponseSchema>;
type ChatRole = 'user' | 'assistant' | 'notice';

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  areaKey?: string;
  sources?: ChatResponse['sources'];
  draftContent?: boolean;
  aiGenerated?: boolean;
}

export interface ChatArea {
  lat: number;
  lon: number;
  name: string;
}

export function ChatDrawer({
  open,
  onClose,
  area,
  dataMode,
  riskLevel,
}: {
  open: boolean;
  onClose: () => void;
  area: ChatArea;
  dataMode: 'live' | 'cache';
  riskLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
}): React.ReactNode {
  const { t, language } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef(`${area.lat.toFixed(3)},${area.lon.toFixed(3)},${area.name}`);

  const areaKey = `${area.lat.toFixed(3)},${area.lon.toFixed(3)},${area.name}`;
  const questions = useMemo(() => [
    t('chatQuestionRisk'),
    t('chatQuestionPrepare'),
    t('chatQuestionRain'),
    t('chatQuestionWater'),
  ], [t]);
  const closeDrawer = useCallback((): void => {
    onClose();
    window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('[data-chat-trigger="true"]')?.focus();
    }, 0);
  }, [onClose]);

  useEffect(() => {
    if (areaRef.current === areaKey) return;
    areaRef.current = areaKey;
    setMessages((current) => [...current, {
      id: crypto.randomUUID(),
      role: 'notice',
      content: t('chatAreaChanged'),
      areaKey,
    }]);
    setError('');
  }, [areaKey, t]);

  useEffect(() => {
    if (open) {
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (open && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages, loading, open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeDrawer();
      } else if (event.key === 'Tab') {
        const dialog = document.querySelector<HTMLElement>('[data-testid="chat-drawer"]');
        const focusable = dialog
          ? [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), input:not(:disabled), a[href]')]
          : [];
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first && last) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last && first) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [closeDrawer, open]);

  if (!open) return null;

  const send = async (value: string): Promise<void> => {
    const question = value.trim();
    if (!question || loading || question.length > 500) return;
    setInput('');
    setError('');
    setLoading(true);
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: question,
      areaKey,
    };
    setMessages((current) => [...current, userMessage]);
    const history = messages.filter((message) => message.areaKey === areaKey)
      .filter((message): message is ChatMessage & { role: 'user' | 'assistant' } =>
        message.role === 'user' || message.role === 'assistant'
      )
      .map(({ role, content }) => ({ role, content }));
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: area.lat,
          lon: area.lon,
          areaName: area.name,
          messages: [...history, { role: 'user', content: question }].slice(-6),
        }),
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const message = typeof payload === 'object' && payload !== null &&
          'error' in payload && typeof payload.error === 'object' && payload.error !== null &&
          'messageTh' in payload.error && typeof payload.error.messageTh === 'string'
          ? payload.error.messageTh
          : t('chatError');
        throw new Error(message);
      }
      const answer = ChatResponseSchema.parse(await response.json());
      appendAnswer(answer);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : t('chatError'));
    } finally {
      setLoading(false);
    }
  };

  const appendAnswer = (answer: ChatResponse): void => {
    setUpdatedAt(answer.updatedAt);
    setMessages((current) => [...current, {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: answer.answer,
      sources: answer.sources,
      draftContent: answer.draftContent,
      aiGenerated: !answer.fallback,
    }]);
  };

  const clearConversation = (): void => {
    setMessages([]);
    setError('');
    setUpdatedAt(null);
  };

  const modeLabel = dataMode === 'cache' ? t('chatModeCache') : t('chatModeLive');

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void send(input);
  };

  return (
    <>
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[79] cursor-default bg-black/55"
      onClick={closeDrawer}
    />
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="chat-drawer-title"
      data-testid="chat-drawer"
      className="chat-drawer glass-drawer fixed right-0 top-0 z-[80] flex h-[100dvh] w-full max-w-[460px] flex-col border-l border-white/15"
    >
      <header className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <h2 id="chat-drawer-title" className="flex items-center gap-2 text-base font-bold">
            <Bot className="h-5 w-5 shrink-0 text-sky-300" aria-hidden="true" />
            {t('chatTitle')}
          </h2>
          <p className="mt-1 truncate text-sm text-slate-100" title={area.name}>{area.name}</p>
          <p className="text-xs text-slate-200">
            {updatedAt
              ? `${t('chatUpdated')} ${new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Asia/Bangkok',
              }).format(new Date(updatedAt))}`
              : t('chatContextUpdatedOnSend')}
          </p>
          <span className="mt-1 inline-flex min-h-[26px] items-center rounded-full bg-sky-300 px-2 text-xs font-semibold text-slate-950">
            {modeLabel}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={t('chatClear')}
            title={t('chatClear')}
            onClick={clearConversation}
            className="glass-icon-btn inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl"
          >
            <Eraser className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t('chatClose')}
            title={t('chatClose')}
            onClick={closeDrawer}
            className="glass-icon-btn inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label={t('chatConversation')}
        className="flex-1 space-y-3 overflow-y-auto px-3 py-4"
      >
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-slate-100">{t('chatIntro')}</p>
            <div className="flex flex-wrap gap-2">
              {questions.map((question) => (
                <button
                  type="button"
                  key={question}
                  disabled={loading}
                  onClick={() => void send(question)}
                  className="glass-control-btn min-h-[44px] rounded-xl px-3 py-2 text-left text-sm"
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message) => message.role === 'notice'
          ? (
            <div key={message.id} className="chat-divider" role="status">
              <span>{message.content}</span>
            </div>
          )
          : (
            <article
              key={message.id}
              className={`max-w-[92%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                message.role === 'user'
                  ? 'ml-auto bg-sky-700 text-white'
                  : 'glass-subcard mr-auto'
              }`}
            >
              <p>{message.content}</p>
              {message.role === 'assistant' && (
                <>
                  {message.draftContent && (
                    <p className="mt-2 text-xs font-semibold text-amber-200">
                      {t('chatDraftLabel')}
                    </p>
                  )}
                  {message.aiGenerated && (
                    <p className="mt-2 text-xs font-semibold text-sky-200">{t('chatAiLabel')}</p>
                  )}
                  {message.sources && message.sources.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5" aria-label={t('chatSources')}>
                      {message.sources.map((source) => (
                        <span
                          key={source.id}
                          className="rounded-full border border-sky-200/30 bg-sky-950/60 px-2 py-1 text-[0.68rem] text-sky-100"
                        >
                          {source.id.startsWith('A')
                            ? t('chatAreaSource')
                            : `${t('chatKbSource')} v${source.version ?? 1}`}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-[0.68rem] text-slate-200">{t('chatDisclaimer')}</p>
                </>
              )}
            </article>
          ))}
        {loading && (
          <div className="glass-subcard mr-auto flex items-center gap-2 rounded-2xl px-3 py-2 text-sm" role="status">
            <span className="chat-typing-dots" aria-hidden="true"><i /><i /><i /></span>
            {t('chatLoading')}
          </div>
        )}
        {error && <p className="rounded-xl border border-rose-300/50 bg-rose-950/70 px-3 py-2 text-sm" role="alert">{error}</p>}
      </div>

      <div className="border-t border-white/10 px-3 pb-3 pt-2">
        {messages.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {questions.slice(0, riskLevel === 'HIGH' ? 3 : 2).map((question) => (
              <button
                type="button"
                key={question}
                disabled={loading}
                onClick={() => void send(question)}
                className="glass-control-btn min-h-[40px] rounded-lg px-2.5 text-xs"
              >
                {question}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={submit} className="flex items-end gap-2">
          <label htmlFor="chat-question" className="sr-only">{t('chatInputLabel')}</label>
          <textarea
            ref={inputRef}
            id="chat-question"
            value={input}
            maxLength={500}
            rows={2}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send(input);
              }
            }}
            placeholder={t('chatInputPlaceholder')}
            className="glass-select min-h-[52px] flex-1 resize-none rounded-xl px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={loading || input.trim().length === 0}
            aria-label={t('chatSend')}
            className="glass-control-btn inline-flex min-h-[52px] min-w-[52px] items-center justify-center rounded-xl disabled:opacity-50"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        </form>
        <p className="mt-2 text-[0.68rem] leading-relaxed text-slate-200">
          {t('chatPrivacy')}
        </p>
      </div>
    </section>
    </>
  );
}
