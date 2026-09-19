import { type ReactNode, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import {
  ArrowDownLeft, ArrowUpRight, BarChart3, Check, ChevronRight, Copy, CreditCard,
  Gauge, LayoutDashboard, Pause, Play, Plus, RefreshCw, ShieldCheck, Ticket,
  Users, WalletCards, X, Zap,
} from 'lucide-react';
import {
  getGetBingoGameQueryKey, getGetBingoOverviewQueryKey, getGetBingoWalletQueryKey,
  getListBingoGamesQueryKey, useAdvanceBingoGame, useCreateBingoGame,
  useGetBingoAdmin, useGetBingoGame, useGetBingoOverview, useGetBingoWallet,
  useHealthCheck, useListBingoCards, useListBingoGames, useSubmitBingoWalletAction,
} from '@workspace/api-client-react';
import type { BingoCard, BingoGame, BingoGameActionAction, BingoWalletEntry } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
type Language = 'en' | 'am';
type Tone = 'coral' | 'mint' | 'gold' | 'ink';

const copy = {
  en: {
    dashboard: 'Live console', live: 'LIVE NOW', demo: 'DEMO MODE', create: 'Create room',
    join: 'Join a room', room: 'Room', wallet: 'Demo wallet', admin: 'Admin oversight',
    activeGames: 'Active games', players: 'Players online', cards: 'Cards available',
    latest: 'Latest room', activity: 'Recent activity', viewRoom: 'Open room', noGames: 'No live rooms yet',
    startOne: 'Start the next round in seconds.', quick: 'Quick actions', createTitle: 'Create a fast room',
    roomName: 'Room name', category: 'Card tier', normal: 'Normal', vip: 'VIP', vvip: 'VVIP',
    cancel: 'Cancel', createRoom: 'Create room', joining: 'Opening…', copyCode: 'Copy code',
    copied: 'Copied', called: 'Called numbers', next: 'NEXT CALL', playersJoined: 'players joined',
    host: 'Host controls', start: 'Start round', call: 'Call next number', pause: 'Pause round',
    reset: 'Reset round', claim: 'Record winner', waiting: 'Waiting room', completed: 'Completed',
    back: 'Back to console', card: 'Your card', free: 'FREE', walletBalance: 'Available demo balance',
    deposit: 'Deposit demo credits', withdraw: 'Withdraw demo credits', method: 'Method',
    amount: 'Amount', submit: 'Submit request', demoNote: 'Demo only — no real money is moved.',
    transactions: 'Recent wallet activity', noTransactions: 'No wallet activity yet.',
    oversight: 'A clear view of the demo floor.', users: 'Total users', inUse: 'Cards in use',
    volume: 'Demo volume', categoryMix: 'Category mix', inventory: 'Card inventory',
    activityLog: 'Activity log', retry: 'Try again', loading: 'Loading console…', hello: 'Good evening',
    language: 'አማ', english: 'EN', joinCode: 'Have a room code?', enterCode: 'Enter share code',
    openRoom: 'Open room', sign: 'Fast rounds. Clear calls.', emptyCards: 'No cards in inventory.',
  },
  am: {
    dashboard: 'የቀጥታ መቆጣጠሪያ', live: 'ቀጥታ', demo: 'የሙከራ ሁነታ', create: 'ክፍል ፍጠር',
    join: 'ክፍል ተቀላቀል', room: 'ክፍል', wallet: 'የሙከራ ቦርሳ', admin: 'አስተዳደር',
    activeGames: 'ንቁ ጨዋታዎች', players: 'ተጫዋቾች', cards: 'የሚገኙ ካርዶች',
    latest: 'የቅርብ ክፍል', activity: 'የቅርብ እንቅስቃሴ', viewRoom: 'ክፍል ክፈት', noGames: 'ቀጥታ ክፍል የለም',
    startOne: 'ቀጣዩን ዙር በጥቂት ሰከንዶች ጀምር።', quick: 'ፈጣን እርምጃዎች', createTitle: 'ፈጣን ክፍል ፍጠር',
    roomName: 'የክፍል ስም', category: 'የካርድ ደረጃ', normal: 'መደበኛ', vip: 'VIP', vvip: 'VVIP',
    cancel: 'ሰርዝ', createRoom: 'ክፍል ፍጠር', joining: 'በመክፈት ላይ…', copyCode: 'ኮድ ቅዳ',
    copied: 'ተቀድቷል', called: 'የተጠሩ ቁጥሮች', next: 'ቀጣይ', playersJoined: 'ተጫዋቾች ተቀላቅለዋል',
    host: 'የአስተናጋጅ ቁጥጥር', start: 'ዙር ጀምር', call: 'ቀጣይ ቁጥር ጥራ', pause: 'አቁም',
    reset: 'ዳግም ጀምር', claim: 'አሸናፊ መዝግብ', waiting: 'የመጠበቂያ ክፍል', completed: 'ተጠናቋል',
    back: 'ወደ መቆጣጠሪያ', card: 'ካርድህ', free: 'ነፃ', walletBalance: 'የሙከራ ቀሪ ሂሳብ',
    deposit: 'የሙከራ ክሬዲት ጨምር', withdraw: 'የሙከራ ክሬዲት አውጣ', method: 'ዘዴ',
    amount: 'መጠን', submit: 'ጥያቄ ላክ', demoNote: 'የሙከራ ብቻ — እውነተኛ ገንዘብ አይንቀሳቀስም።',
    transactions: 'የቅርብ የቦርሳ እንቅስቃሴ', noTransactions: 'እስካሁን እንቅስቃሴ የለም።',
    oversight: 'የሙከራ ወለሉን በግልጽ ይመልከቱ።', users: 'ጠቅላላ ተጠቃሚዎች', inUse: 'በጥቅም ላይ ያሉ ካርዶች',
    volume: 'የሙከራ መጠን', categoryMix: 'የደረጃ ድርሻ', inventory: 'የካርድ ክምችት',
    activityLog: 'የእንቅስቃሴ መዝገብ', retry: 'እንደገና ሞክር', loading: 'በመጫን ላይ…', hello: 'መልካም ምሽት',
    language: 'አማ', english: 'EN', joinCode: 'የክፍል ኮድ አለዎት?', enterCode: 'የማጋሪያ ኮድ ያስገቡ',
    openRoom: 'ክፍል ክፈት', sign: 'ፈጣን ዙሮች። ግልጽ ጥሪዎች።', emptyCards: 'በክምችት ውስጥ ካርድ የለም።',
  },
} as const;

function money(amount: number, currency = 'ETB') {
  return `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ErrorState({ onRetry, text }: { onRetry?: () => void; text?: string }) {
  return <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
    <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive"><X size={18} /></div>
    <p className="text-sm text-muted-foreground">{text ?? 'Something interrupted the live feed.'}</p>
    {onRetry && <button data-testid="button-retry" onClick={onRetry} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted"><RefreshCw size={14} />Try again</button>}
  </div>;
}

function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return <div className="space-y-3" aria-label={label}><div className="h-24 animate-pulse rounded-2xl bg-muted" /><div className="h-44 animate-pulse rounded-2xl bg-muted" /><div className="h-28 animate-pulse rounded-2xl bg-muted" /></div>;
}

function Badge({ children, tone = 'ink' }: { children: ReactNode; tone?: Tone }) {
  const styles: Record<Tone, string> = { coral: 'bg-primary/12 text-primary', mint: 'bg-secondary text-secondary-foreground', gold: 'bg-accent text-accent-foreground', ink: 'bg-foreground/8 text-foreground' };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.12em] ${styles[tone]}`}>{children}</span>;
}

function Shell({ children, lang, setLang }: { children: ReactNode; lang: Language; setLang: (l: Language) => void }) {
  const [location] = useLocation();
  const health = useHealthCheck();
  const t = copy[lang];
  const nav = [
    { href: '/', label: t.dashboard, icon: LayoutDashboard },
    { href: '/wallet', label: t.wallet, icon: WalletCards },
    { href: '/admin', label: t.admin, icon: ShieldCheck },
  ];
  return <div className="noise min-h-[100dvh] bg-background">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-sidebar px-5 py-6 text-sidebar-foreground lg:flex">
      <Link href="/" data-testid="link-brand" className="mb-12 flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground"><Zap size={20} fill="currentColor" /></div>
        <div><div className="text-lg font-bold tracking-tight">Fast Bingo</div><div className="mono text-[9px] uppercase tracking-[.2em] text-sidebar-foreground/55">Telegram console</div></div>
      </Link>
      <div className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[.2em] text-sidebar-foreground/40">Workspace</div>
      <nav className="space-y-1">
        {nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} data-testid={`link-nav-${href === '/' ? 'dashboard' : href.slice(1)}`} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition ${location === href ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'}`}><Icon size={17} /><span>{label}</span>{location === href && <ChevronRight size={14} className="ml-auto text-sidebar-primary" />}</Link>)}
      </nav>
      <div className="mt-auto rounded-2xl border border-sidebar-border bg-sidebar-accent/60 p-4">
        <div className="mb-3 flex items-center gap-2"><span className={`${health.isError ? '' : 'live-dot'} size-2 rounded-full ${health.isError ? 'bg-destructive' : 'bg-sidebar-primary'}`} /><span className="mono text-[10px] uppercase tracking-[.16em] text-sidebar-foreground/55">{health.data?.status === 'ok' ? t.live : t.demo}</span></div>
        <div className="text-sm font-semibold">{t.sign}</div><div className="mt-1 text-xs text-sidebar-foreground/50">{t.demo}</div>
      </div>
    </aside>
    <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-border/80 bg-background/90 px-4 backdrop-blur lg:ml-64 lg:px-8">
      <Link href="/" className="flex items-center gap-2 lg:hidden" data-testid="link-mobile-brand"><span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Zap size={16} fill="currentColor" /></span><span className="font-bold">Fast Bingo</span></Link>
      <div className="hidden lg:block"><span className="mono text-[10px] uppercase tracking-[.22em] text-muted-foreground">{t.demo}</span></div>
      <div className="ml-auto flex items-center gap-2">
        <button data-testid="button-language" onClick={() => setLang(lang === 'en' ? 'am' : 'en')} className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-bold shadow-sm hover:bg-muted"><span className="text-primary">{lang === 'en' ? 'EN' : 'አማ'}</span><span className="mx-1 text-muted-foreground">/</span><span className="text-muted-foreground">{lang === 'en' ? 'አማ' : 'EN'}</span></button>
        <div className="flex size-8 items-center justify-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground">FB</div>
      </div>
    </header>
    <main className="pb-24 lg:ml-64 lg:pb-8">{children}</main>
    <nav className="fixed inset-x-0 bottom-0 z-30 flex h-[70px] items-center justify-around border-t border-border bg-card/95 px-3 backdrop-blur lg:hidden">
      {nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} data-testid={`link-mobile-${href === '/' ? 'dashboard' : href.slice(1)}`} className={`flex min-w-20 flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-semibold ${location === href ? 'text-primary' : 'text-muted-foreground'}`}><Icon size={19} /><span>{label}</span></Link>)}
    </nav>
  </div>;
}

function SectionTitle({ eyebrow, title, detail }: { eyebrow?: string; title: string; detail?: string }) {
  return <div className="mb-5"><div className="mono mb-1 text-[10px] font-medium uppercase tracking-[.2em] text-primary">{eyebrow}</div><h2 className="text-xl font-bold tracking-tight text-foreground">{title}</h2>{detail && <p className="mt-1 text-sm text-muted-foreground">{detail}</p>}</div>;
}

function Metric({ label, value, icon: Icon, accent = 'coral', detail }: { label: string; value: ReactNode; icon: typeof Users; accent?: Tone; detail?: string }) {
  const border: Record<Tone, string> = { coral: 'border-l-primary', mint: 'border-l-secondary-foreground', gold: 'border-l-accent', ink: 'border-l-foreground' };
  return <div className={`rounded-2xl border border-border border-l-4 ${border[accent]} bg-card p-4 shadow-sm`} data-testid={`metric-${label.toLowerCase().replace(/\s+/g, '-')}`}><div className="flex items-start justify-between"><span className="text-xs font-semibold text-muted-foreground">{label}</span><Icon size={16} className="text-muted-foreground" /></div><div className="mt-3 text-2xl font-bold tracking-tight">{value}</div>{detail && <div className="mt-1 text-[11px] text-muted-foreground">{detail}</div>}</div>;
}

function CreateRoomModal({ lang, onClose }: { lang: Language; onClose: () => void }) {
  const t = copy[lang];
  const [name, setName] = useState('');
  const [category, setCategory] = useState<'normal' | 'vip' | 'vvip'>('normal');
  const create = useCreateBingoGame();
  const [, setLocation] = useLocation();
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    create.mutate({ data: { name: name.trim(), category } }, { onSuccess: (game) => { onClose(); setLocation(`/play/${game.id}`); } });
  };
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/45 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
    <div className="w-full max-w-md rounded-t-3xl border border-border bg-card p-6 shadow-lg sm:rounded-3xl">
      <div className="mb-6 flex items-start justify-between"><div><Badge tone="coral">{t.demo}</Badge><h2 className="mt-3 text-2xl font-bold">{t.createTitle}</h2></div><button data-testid="button-close-create" onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><X size={18} /></button></div>
      <form onSubmit={submit} className="space-y-5">
        <label className="block"><span className="mb-2 block text-xs font-semibold text-muted-foreground">{t.roomName}</span><input data-testid="input-room-name" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Friday night sprint" className="h-12 w-full rounded-xl border border-input bg-background px-4 text-sm outline-none ring-primary/30 placeholder:text-muted-foreground/50 focus:ring-4" /></label>
        <div><span className="mb-2 block text-xs font-semibold text-muted-foreground">{t.category}</span><div className="grid grid-cols-3 gap-2">{(['normal', 'vip', 'vvip'] as const).map(item => <button type="button" key={item} data-testid={`button-category-${item}`} onClick={() => setCategory(item)} className={`rounded-xl border px-2 py-3 text-sm font-semibold transition ${category === item ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background hover:bg-muted'}`}>{t[item]}</button>)}</div></div>
        <div className="flex gap-3 pt-1"><button type="button" data-testid="button-cancel-create" onClick={onClose} className="h-12 flex-1 rounded-xl border border-border font-semibold hover:bg-muted">{t.cancel}</button><button disabled={create.isPending} data-testid="button-submit-create" className="h-12 flex-1 rounded-xl bg-primary font-bold text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-60">{create.isPending ? t.joining : t.createRoom}</button></div>
        {create.isError && <p className="text-center text-xs text-destructive">Could not create this demo room. Try again.</p>}
      </form>
    </div>
  </div>;
}

function HomePage({ lang }: { lang: Language }) {
  const t = copy[lang];
  const [showCreate, setShowCreate] = useState(false);
  const [roomCode, setRoomCode] = useState('');
  const [, setLocation] = useLocation();
  const overview = useGetBingoOverview();
  const games = useListBingoGames();
  const wallet = useGetBingoWallet();
  const loading = overview.isLoading || games.isLoading || wallet.isLoading;
  if (loading) return <div className="mx-auto max-w-7xl p-4 lg:p-8"><LoadingState label={t.loading} /></div>;
  if (overview.isError || games.isError || wallet.isError) return <div className="mx-auto max-w-7xl p-4 lg:p-8"><ErrorState onRetry={() => { overview.refetch(); games.refetch(); wallet.refetch(); }} /></div>;
  const data = overview.data;
  const gameList = games.data ?? [];
  const balance = wallet.data;
  return <div className="mx-auto max-w-7xl p-4 lg:p-8">
    <div className="animate-rise mb-7 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><div className="mono mb-2 text-[10px] uppercase tracking-[.2em] text-primary">{t.live} · {t.demo}</div><h1 className="text-3xl font-bold tracking-tight md:text-4xl">{t.hello}, <span className="text-primary">player.</span></h1><p className="mt-2 text-sm text-muted-foreground">{t.startOne}</p></div><div className="flex gap-2"><button data-testid="button-open-create" onClick={() => setShowCreate(true)} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-95"><Plus size={17} />{t.create}</button></div></div>
    <div className="mb-7 grid grid-cols-2 gap-3 md:grid-cols-4"><Metric label={t.activeGames} value={data?.activeGames ?? 0} icon={Gauge} /><Metric label={t.players} value={data?.playersOnline ?? 0} icon={Users} accent="mint" /><Metric label={t.cards} value={data?.cardsAvailable ?? 0} icon={Ticket} accent="gold" /><Metric label={t.walletBalance} value={money(data?.demoBalance ?? balance?.balance ?? 0, balance?.currency)} icon={WalletCards} accent="ink" /></div>
    <div className="grid gap-6 xl:grid-cols-[1.35fr_.65fr]">
      <section className="rounded-3xl border border-border bg-card p-5 shadow-sm md:p-6">
        <div className="mb-5 flex items-start justify-between"><SectionTitle eyebrow={t.live} title={t.latest} /><Badge tone={data?.latestGame?.status === 'live' ? 'coral' : 'gold'}>{data?.latestGame?.status ?? '—'}</Badge></div>
        {data?.latestGame ? <FeaturedGame game={data.latestGame} lang={lang} /> : <div className="rounded-2xl bg-muted p-8 text-center text-sm text-muted-foreground">{t.noGames}</div>}
      </section>
      <section className="rounded-3xl border border-border bg-card p-5 shadow-sm md:p-6"><SectionTitle eyebrow={t.wallet} title={t.quick} /><div className="rounded-2xl bg-foreground p-5 text-background"><div className="flex items-center justify-between"><span className="mono text-[10px] uppercase tracking-[.16em] text-background/55">{t.demo}</span><CreditCard size={18} className="text-primary" /></div><div className="mt-6 text-3xl font-bold">{money(balance?.balance ?? 0, balance?.currency)}</div><Link href="/wallet" data-testid="link-wallet-snapshot" className="mt-5 flex items-center justify-between border-t border-background/15 pt-4 text-xs font-semibold text-background/70 hover:text-background"><span>{t.wallet}</span><ChevronRight size={15} /></Link></div><div className="mt-3 grid grid-cols-2 gap-2"><button data-testid="button-quick-create" onClick={() => setShowCreate(true)} className="rounded-xl border border-border p-3 text-left text-xs font-semibold hover:bg-muted"><Plus size={15} className="mb-2 text-primary" />{t.create}</button><Link href="/admin" data-testid="link-quick-admin" className="rounded-xl border border-border p-3 text-left text-xs font-semibold hover:bg-muted"><BarChart3 size={15} className="mb-2 text-secondary-foreground" />{t.admin}</Link></div></section>
    </div>
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
      <section><SectionTitle eyebrow={t.room} title={t.activeGames} /><div className="space-y-2">{gameList.length ? gameList.slice(0, 4).map(game => <GameRow key={game.id} game={game} lang={lang} />) : <div className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">{t.noGames}</div>}</div></section>
      <section><SectionTitle eyebrow={t.activity} title={t.activity} /><div className="rounded-2xl border border-border bg-card p-2 shadow-sm">{data?.recentActivity?.length ? data.recentActivity.slice(0, 5).map(item => <div key={item.id} data-testid={`activity-${item.id}`} className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-muted"><span className={`size-2 rounded-full ${item.tone === 'success' ? 'bg-secondary-foreground' : item.tone === 'warning' ? 'bg-accent-foreground' : 'bg-primary'}`} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{item.title}</div><div className="truncate text-xs text-muted-foreground">{item.detail}</div></div><span className="mono text-[10px] text-muted-foreground">{item.time}</span></div>) : <div className="p-5 text-sm text-muted-foreground">No recent activity.</div>}</div></section>
    </div>
    <section className="mt-6 rounded-2xl border border-dashed border-border bg-card/60 p-4"><div className="flex flex-col gap-3 md:flex-row md:items-center"><div className="flex-1"><div className="text-sm font-bold">{t.joinCode}</div><div className="text-xs text-muted-foreground">{t.enterCode}</div></div><div className="flex gap-2"><input data-testid="input-join-code" value={roomCode} onChange={e => setRoomCode(e.target.value)} placeholder="FB-7Q2K" className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm uppercase outline-none focus:ring-2 focus:ring-primary/30 md:w-40" /><button data-testid="button-open-room" disabled={!roomCode.trim()} onClick={() => setLocation(`/play/${roomCode.trim()}`)} className="h-10 rounded-lg bg-foreground px-4 text-sm font-bold text-background disabled:opacity-40">{t.openRoom}</button></div></div></section>
    {showCreate && <CreateRoomModal lang={lang} onClose={() => setShowCreate(false)} />}
  </div>;
}

function FeaturedGame({ game, lang }: { game: BingoGame; lang: Language }) {
  const t = copy[lang];
  return <div className="grid gap-5 md:grid-cols-[1fr_180px]"><div><div className="flex items-center gap-2"><span className="live-dot size-2 rounded-full bg-primary" /><span className="mono text-[10px] font-medium uppercase tracking-[.18em] text-primary">{game.status === 'live' ? t.live : game.status}</span></div><h3 className="mt-3 text-2xl font-bold">{game.name}</h3><p className="mt-1 text-sm text-muted-foreground">Hosted by {game.hostName} · {game.players.length} {t.playersJoined}</p><div className="mt-5 flex flex-wrap gap-2"><Badge tone="mint">{game.shareCode}</Badge><Badge tone="ink">{game.winnerCount} winners</Badge></div><Link href={`/play/${game.id}`} data-testid={`link-featured-game-${game.id}`} className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-primary hover:gap-3 transition-all">{t.viewRoom}<ChevronRight size={16} /></Link></div><div className="rounded-2xl bg-primary p-5 text-primary-foreground"><div className="mono text-[10px] uppercase tracking-[.18em] text-primary-foreground/65">{t.next}</div><div className="mt-3 text-6xl font-bold">{game.currentNumber || '—'}</div><div className="mt-3 border-t border-primary-foreground/20 pt-3 text-xs text-primary-foreground/70">{game.nextCallIn}s until call</div></div></div>;
}

function GameRow({ game, lang }: { game: BingoGame; lang: Language }) {
  const t = copy[lang];
  return <Link href={`/play/${game.id}`} data-testid={`link-game-${game.id}`} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><div className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${game.status === 'live' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}><Ticket size={18} /></div><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{game.name}</div><div className="mt-0.5 text-xs text-muted-foreground">{game.players.length} {t.playersJoined} · {game.shareCode}</div></div><Badge tone={game.status === 'live' ? 'coral' : game.status === 'waiting' ? 'gold' : 'ink'}>{game.status}</Badge><ChevronRight size={15} className="text-muted-foreground" /></Link>;
}

function BingoGrid({ card, called, lang }: { card?: BingoCard; called: number[]; lang: Language }) {
  const t = copy[lang];
  const fallback = Array.from({ length: 25 }, (_, i) => i + 1);
  const nums = card?.numbers?.length === 25 ? card.numbers : fallback;
  const marked = new Set([...(card?.marked ?? []), ...called]);
  return <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"><div className="grid grid-cols-5 border-b border-border bg-foreground text-center text-xs font-bold text-background">{['B', 'I', 'N', 'G', 'O'].map(letter => <div key={letter} className="py-2.5">{letter}</div>)}</div><div className="grid grid-cols-5 gap-px bg-border p-px">{nums.map((number, index) => { const isFree = index === 12; const isMarked = isFree || marked.has(number); return <div key={`${number}-${index}`} data-testid={`card-cell-${index}`} className={`relative flex aspect-square items-center justify-center bg-card text-sm font-semibold ${isMarked ? 'bg-primary/12 text-primary' : ''}`}>{isFree ? <span className="text-[9px] font-bold uppercase tracking-wider">{t.free}</span> : number}{isMarked && !isFree && <span className="absolute inset-2 rounded-full border-2 border-primary/60" />}</div>; })}</div></div>;
}

function GamePage({ lang }: { lang: Language }) {
  const t = copy[lang];
  const params = useParams<{ gameId: string }>();
  const gameQuery = useGetBingoGame(params.gameId);
  const cards = useListBingoCards();
  const advance = useAdvanceBingoGame();
  const client = useQueryClient();
  const [isHost, setIsHost] = useState(true);
  const [copied, setCopied] = useState(false);
  if (gameQuery.isLoading || cards.isLoading) return <div className="mx-auto max-w-6xl p-4 lg:p-8"><LoadingState label={t.loading} /></div>;
  if (gameQuery.isError || !gameQuery.data) return <div className="mx-auto max-w-6xl p-4 lg:p-8"><ErrorState onRetry={() => gameQuery.refetch()} /></div>;
  const game = gameQuery.data;
  const card = (cards.data ?? []).find(item => item.status === 'in-play') ?? (cards.data ?? [])[0];
  const call = (action: BingoGameActionAction) => advance.mutate({ gameId: game.id, data: { action } }, { onSuccess: () => { client.invalidateQueries({ queryKey: getGetBingoGameQueryKey(game.id) }); client.invalidateQueries({ queryKey: getListBingoGamesQueryKey() }); client.invalidateQueries({ queryKey: getGetBingoOverviewQueryKey() }); } });
  const copyCode = async () => { await navigator.clipboard?.writeText(game.shareCode); setCopied(true); window.setTimeout(() => setCopied(false), 1500); };
  return <div className="mx-auto max-w-6xl p-4 lg:p-8">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><Link href="/" data-testid="link-back-dashboard" className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground">← {t.back}</Link><div className="flex items-center gap-2"><button data-testid="button-copy-code" onClick={copyCode} className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-bold hover:bg-muted">{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? t.copied : `${t.copyCode} · ${game.shareCode}`}</button><button data-testid="button-toggle-host" onClick={() => setIsHost(!isHost)} className={`rounded-lg px-3 py-2 text-xs font-bold ${isHost ? 'bg-foreground text-background' : 'border border-border bg-card'}`}>{isHost ? t.host : 'Player view'}</button></div></div>
    <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><div className="flex items-center gap-2"><span className={`size-2 rounded-full ${game.status === 'live' ? 'live-dot bg-primary' : 'bg-muted-foreground'}`} /><span className="mono text-[10px] uppercase tracking-[.2em] text-primary">{game.status === 'live' ? t.live : game.status === 'waiting' ? t.waiting : t.completed}</span></div><h1 className="mt-2 text-3xl font-bold tracking-tight">{game.name}</h1><p className="mt-1 text-sm text-muted-foreground">Hosted by {game.hostName} · {game.players.length} {t.playersJoined}</p></div><div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm"><div><div className="mono text-[9px] uppercase tracking-[.16em] text-muted-foreground">{t.next}</div><div className="text-2xl font-bold text-primary">{game.currentNumber || '—'}</div></div><div className="h-9 w-px bg-border" /><div className="text-right"><div className="mono text-[9px] uppercase tracking-[.16em] text-muted-foreground">in</div><div className="text-sm font-bold">{game.nextCallIn}s</div></div></div></div>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section><div className="mb-3 flex items-center justify-between"><SectionTitle eyebrow={t.card} title={card?.label ?? 'Player card'} /><Badge tone={card?.category === 'vvip' ? 'gold' : card?.category === 'vip' ? 'mint' : 'ink'}>{card?.category ?? 'normal'}</Badge></div><BingoGrid card={card} called={game.calledNumbers} lang={lang} /><div className="mt-3 flex items-center justify-between rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground"><span>{game.calledNumbers.length} {t.called.toLowerCase()}</span><span className="mono">{game.shareCode}</span></div></section>
      <aside className="space-y-5"><section className="rounded-2xl border border-border bg-card p-5 shadow-sm"><SectionTitle eyebrow={t.called} title={t.called} /><div className="flex flex-wrap gap-2">{game.calledNumbers.length ? game.calledNumbers.slice().reverse().map((number, index) => <span key={`${number}-${index}`} data-testid={`called-number-${number}`} className={`flex size-9 items-center justify-center rounded-lg text-sm font-bold ${index === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>{number}</span>) : <span className="text-sm text-muted-foreground">No numbers called yet.</span>}</div></section>
      {isHost && <section className="rounded-2xl border border-border bg-card p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><SectionTitle eyebrow={t.host} title={t.host} /><Badge tone="coral">{t.demo}</Badge></div><div className="grid gap-2">{game.status === 'waiting' && <ActionButton icon={Play} label={t.start} onClick={() => call('start')} pending={advance.isPending} primary />}{game.status === 'live' && <><ActionButton icon={Zap} label={t.call} onClick={() => call('call')} pending={advance.isPending} primary /><div className="grid grid-cols-2 gap-2"><ActionButton icon={Pause} label={t.pause} onClick={() => call('pause')} pending={advance.isPending} /><ActionButton icon={Check} label={t.claim} onClick={() => call('claim')} pending={advance.isPending} /></div></>}{game.status !== 'completed' && <ActionButton icon={RefreshCw} label={t.reset} onClick={() => call('reset')} pending={advance.isPending} />}</div>{advance.isError && <p className="mt-3 text-xs text-destructive">Action could not be completed.</p>}</section>}
      <section className="rounded-2xl bg-foreground p-5 text-background"><div className="flex items-center gap-2 text-primary"><Users size={16} /><span className="mono text-[10px] uppercase tracking-[.18em]">{t.players}</span></div><div className="mt-3 space-y-2">{game.players.slice(0, 4).map(player => <div key={player.id} className="flex items-center gap-2"><span className="flex size-7 items-center justify-center rounded-full bg-background/10 text-[10px] font-bold">{player.initials}</span><span className="flex-1 truncate text-sm">{player.name}</span><span className="text-[10px] text-background/45">{player.cardLabel}</span></div>)}</div></section></aside>
    </div>
  </div>;
}

function ActionButton({ icon: Icon, label, onClick, pending, primary = false }: { icon: typeof Play; label: string; onClick: () => void; pending: boolean; primary?: boolean }) {
  return <button disabled={pending} data-testid={`button-action-${label.toLowerCase().replace(/\s+/g, '-')}`} onClick={onClick} className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-bold transition disabled:opacity-50 ${primary ? 'bg-primary text-primary-foreground hover:brightness-95' : 'border border-border bg-background hover:bg-muted'}`}><Icon size={16} />{pending ? 'Working…' : label}</button>;
}

function WalletPage({ lang }: { lang: Language }) {
  const t = copy[lang];
  const wallet = useGetBingoWallet();
  const action = useSubmitBingoWalletAction();
  const client = useQueryClient();
  const [type, setType] = useState<'deposit' | 'withdrawal'>('deposit');
  const [method, setMethod] = useState<'telebirr' | 'ebirr' | 'mpesa'>('telebirr');
  const [amount, setAmount] = useState('25');
  if (wallet.isLoading) return <div className="mx-auto max-w-5xl p-4 lg:p-8"><LoadingState label={t.loading} /></div>;
  if (wallet.isError || !wallet.data) return <div className="mx-auto max-w-5xl p-4 lg:p-8"><ErrorState onRetry={() => wallet.refetch()} /></div>;
  const data = wallet.data;
  const submit = () => { const parsed = Number(amount); if (!parsed || parsed < 1) return; action.mutate({ data: { type, method, amount: parsed } }, { onSuccess: () => { client.invalidateQueries({ queryKey: getGetBingoWalletQueryKey() }); } }); };
  return <div className="mx-auto max-w-5xl p-4 lg:p-8"><div className="mb-8"><div className="mono mb-2 text-[10px] uppercase tracking-[.2em] text-primary">{t.demo}</div><h1 className="text-3xl font-bold tracking-tight">{t.wallet}</h1><p className="mt-2 text-sm text-muted-foreground">{t.demoNote}</p></div><div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]"><section className="rounded-3xl bg-foreground p-6 text-background shadow-md"><div className="flex items-center justify-between"><div className="flex items-center gap-2 text-background/60"><WalletCards size={16} /><span className="mono text-[10px] uppercase tracking-[.2em]">{t.walletBalance}</span></div><Badge tone="coral">{data.currency}</Badge></div><div className="mt-12 text-4xl font-bold tracking-tight">{money(data.balance, data.currency)}</div><div className="mt-3 flex items-center gap-2 text-xs text-background/50"><span className="size-2 rounded-full bg-secondary-foreground" />Sandbox balance · resets in demo</div><div className="mt-10 grid grid-cols-2 gap-2"><button data-testid="button-set-deposit" onClick={() => setType('deposit')} className={`rounded-xl p-3 text-left text-xs font-bold ${type === 'deposit' ? 'bg-primary text-primary-foreground' : 'bg-background/10'}`}><ArrowDownLeft size={15} className="mb-2" />{t.deposit}</button><button data-testid="button-set-withdraw" onClick={() => setType('withdrawal')} className={`rounded-xl p-3 text-left text-xs font-bold ${type === 'withdrawal' ? 'bg-primary text-primary-foreground' : 'bg-background/10'}`}><ArrowUpRight size={15} className="mb-2" />{t.withdraw}</button></div></section><section className="rounded-3xl border border-border bg-card p-6 shadow-sm"><SectionTitle eyebrow={type === 'deposit' ? t.deposit : t.withdraw} title={t.submit} /><div className="space-y-5"><label className="block"><span className="mb-2 block text-xs font-semibold text-muted-foreground">{t.amount}</span><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{data.currency}</span><input data-testid="input-wallet-amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className="h-12 w-full rounded-xl border border-input bg-background pl-14 pr-3 text-lg font-bold outline-none focus:ring-4 focus:ring-primary/20" /></div></label><div><span className="mb-2 block text-xs font-semibold text-muted-foreground">{t.method}</span><div className="grid grid-cols-3 gap-2">{(['telebirr', 'ebirr', 'mpesa'] as const).map(item => <button key={item} data-testid={`button-method-${item}`} onClick={() => setMethod(item)} className={`rounded-xl border px-2 py-3 text-xs font-bold ${method === item ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'}`}>{item}</button>)}</div></div><button disabled={action.isPending} data-testid="button-submit-wallet" onClick={submit} className="h-12 w-full rounded-xl bg-primary font-bold text-primary-foreground hover:brightness-95 disabled:opacity-50">{action.isPending ? 'Submitting…' : t.submit}</button>{action.isSuccess && <div className="flex items-center gap-2 rounded-xl bg-secondary p-3 text-xs font-semibold text-secondary-foreground"><Check size={15} />Demo request recorded.</div>}{action.isError && <p className="text-xs text-destructive">The demo request failed. Try again.</p>}</div></section></div><section className="mt-8"><SectionTitle eyebrow={t.transactions} title={t.transactions} /><div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">{data.entries?.length ? data.entries.map((entry: BingoWalletEntry) => <div key={entry.id} data-testid={`wallet-entry-${entry.id}`} className="flex items-center gap-3 border-b border-border px-4 py-4 last:border-0"><div className={`flex size-9 items-center justify-center rounded-lg ${entry.type === 'deposit' ? 'bg-secondary text-secondary-foreground' : 'bg-primary/10 text-primary'}`}>{entry.type === 'deposit' ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}</div><div className="min-w-0 flex-1"><div className="text-sm font-bold capitalize">{entry.type}</div><div className="text-xs text-muted-foreground">{entry.method} · {entry.status}</div></div><div className="text-right"><div className="mono text-sm font-medium">{entry.type === 'deposit' ? '+' : '-'}{money(entry.amount, data.currency)}</div><div className="text-[10px] text-muted-foreground">{new Date(entry.createdAt).toLocaleDateString()}</div></div></div>) : <div className="p-8 text-center text-sm text-muted-foreground">{t.noTransactions}</div>}</div></section></div>;
}

function AdminPage({ lang }: { lang: Language }) {
  const t = copy[lang];
  const admin = useGetBingoAdmin();
  const cards = useListBingoCards();
  const games = useListBingoGames();
  const [filter, setFilter] = useState<'all' | 'normal' | 'vip' | 'vvip'>('all');
  if (admin.isLoading || cards.isLoading || games.isLoading) return <div className="mx-auto max-w-7xl p-4 lg:p-8"><LoadingState label={t.loading} /></div>;
  if (admin.isError || cards.isError || games.isError || !admin.data) return <div className="mx-auto max-w-7xl p-4 lg:p-8"><ErrorState onRetry={() => { admin.refetch(); cards.refetch(); games.refetch(); }} /></div>;
  const data = admin.data;
  const filtered = (cards.data ?? []).filter(card => filter === 'all' || card.category === filter);
  return <div className="mx-auto max-w-7xl p-4 lg:p-8"><div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><div className="mono mb-2 text-[10px] uppercase tracking-[.2em] text-primary">{t.admin} · {t.demo}</div><h1 className="text-3xl font-bold tracking-tight">{t.oversight}</h1></div><Badge tone="mint"><span className="live-dot mr-2 size-1.5 rounded-full bg-secondary-foreground" />System nominal</Badge></div><div className="grid grid-cols-2 gap-3 xl:grid-cols-4"><Metric label={t.users} value={data.totalUsers} icon={Users} /><Metric label={t.activeGames} value={data.activeGames} icon={Gauge} accent="mint" /><Metric label={t.inUse} value={data.cardsInUse} icon={Ticket} accent="gold" /><Metric label={t.volume} value={money(data.demoVolume)} icon={BarChart3} accent="ink" /></div><div className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_.85fr]"><section className="rounded-2xl border border-border bg-card p-5 shadow-sm"><SectionTitle eyebrow={t.inventory} title={t.inventory} detail={`${filtered.length} cards in current view`} /><div className="mb-4 flex gap-2 overflow-x-auto pb-1">{(['all', 'normal', 'vip', 'vvip'] as const).map(item => <button key={item} data-testid={`button-filter-${item}`} onClick={() => setFilter(item)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-bold capitalize ${filter === item ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}>{item}</button>)}</div><div className="overflow-hidden rounded-xl border border-border">{filtered.length ? filtered.slice(0, 8).map(card => <div key={card.id} data-testid={`inventory-card-${card.id}`} className="flex items-center gap-3 border-b border-border px-3 py-3 last:border-0"><div className="flex size-8 items-center justify-center rounded-lg bg-muted"><Ticket size={14} /></div><div className="flex-1"><div className="text-sm font-bold">{card.label}</div><div className="text-[11px] text-muted-foreground">{card.id} · {card.numbers.length} numbers</div></div><Badge tone={card.status === 'in-play' ? 'coral' : card.status === 'reserved' ? 'gold' : 'mint'}>{card.status}</Badge></div>) : <div className="p-8 text-center text-sm text-muted-foreground">{t.emptyCards}</div>}</div></section><section className="space-y-6"><div className="rounded-2xl border border-border bg-card p-5 shadow-sm"><SectionTitle eyebrow={t.categoryMix} title={t.categoryMix} />{data.topCategories.map(item => <div key={item.category} className="mb-4 last:mb-0"><div className="mb-2 flex justify-between text-xs font-semibold"><span className="capitalize">{item.category}</span><span className="mono text-muted-foreground">{item.players} · {Math.round(item.share * 100)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${item.category === 'normal' ? 'bg-secondary-foreground' : item.category === 'vip' ? 'bg-primary' : 'bg-accent-foreground'}`} style={{ width: `${Math.min(item.share * 100, 100)}%` }} /></div></div>)}</div><div className="rounded-2xl border border-border bg-card p-5 shadow-sm"><SectionTitle eyebrow={t.activityLog} title={t.activityLog} /><div className="space-y-3">{data.activity.slice(0, 5).map(item => <div key={item.id} className="flex gap-3"><span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" /><div className="min-w-0"><div className="text-sm font-semibold">{item.title}</div><div className="text-xs text-muted-foreground">{item.detail} · {item.time}</div></div></div>)}</div></div></section></div></div>;
}

function Router({ lang, setLang }: { lang: Language; setLang: (l: Language) => void }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Shell lang={lang} setLang={setLang}><Switch><Route path="/" component={() => <HomePage lang={lang} />} /><Route path="/play/:gameId" component={() => <GamePage lang={lang} />} /><Route path="/wallet" component={() => <WalletPage lang={lang} />} /><Route path="/admin" component={() => <AdminPage lang={lang} />} /><Route component={NotFound} /></Switch></Shell></ErrorBoundary>;
}

function App() {
  const [lang, setLang] = useState<Language>('en');
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router lang={lang} setLang={setLang} /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;