import {

  type ReactNode,

  useEffect,

  useMemo,

  useRef,

  useState,

} from "react";

import {

  QueryClient,

  QueryClientProvider,

  useQueryClient,

} from "@tanstack/react-query";

import {

  Route,

  Switch,

  useLocation,

  useParams,

  Router as WouterRouter,

} from "wouter";

import {

  ArrowDownLeft,

  ArrowUpRight,

  Check,

  ChevronRight,

  CircleDollarSign,

  Clock3,

  Copy,

  CreditCard,

  Crown,

  Gift,

  HelpCircle,

  Pause,

  Play,

  RefreshCw,

  ShieldCheck,

  Sparkles,

  Ticket,

  Trophy,

  Users,

  Volume2,

  VolumeX,

  WalletCards,

  X,

  Zap,

} from "lucide-react";

import {

  getGetBingoGameQueryKey,

  getGetBingoOverviewQueryKey,

  getGetBingoWalletQueryKey,

  getListBingoGamesQueryKey,

  useAdvanceBingoGame,

  useGetBingoAdmin,

  useGetBingoGame,

  useGetBingoOverview,

  useGetBingoWallet,

  useListBingoCards,

  useListBingoGames,

  useSubmitBingoWalletAction,

} from "@workspace/api-client-react";

import type {

  BingoCard,

  BingoGame,

  BingoGameActionAction,

  BingoWalletEntry,

} from "@workspace/api-client-react";

import { ErrorBoundary } from "@/components/error-boundary";

import { Toaster } from "@/components/ui/toaster";

import { TooltipProvider } from "@/components/ui/tooltip";

import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

type Language = "en" | "am";

const CARD_PRICE = 10;

const PRIZE_PER_CARD = 8;

const copy = {

  en: {

    bingo: "BINGO",

    play: "Play",

    live: "LIVE",

    lobby: "LOBBY",

    waiting: "Waiting for players",

    startsIn: "Starts in",

    players: "Players",

    card: "Card",

    cards: "Cards",

    balance: "Balance",

    wallet: "Wallet",

    called: "Called",

    latest: "Latest",

    next: "Next",

    voice: "Voice",

    voiceOn: "Voice on",

    voiceOff: "Voice off",

    chooseCard: "Choose your card",

    selected: "Selected",

    choose: "Choose",

    free: "FREE",

    prizePool: "Prize pool",

    price: "Price",

    winner: "WINNER",

    winners: "WINNERS",

    congratulations: "Congratulations!",

    twoLines: "2 lines completed",

    waitingNumber: "Waiting for the first number",

    numbersCalled: "numbers called",

    roundFinished: "Round finished",

    playAgain: "Play again",

    back: "Back",

    deposit: "Deposit",

    withdraw: "Withdraw",

    amount: "Amount",

    method: "Method",

    submit: "Submit",

    transactions: "Transactions",

    noTransactions: "No transactions yet.",

    help: "Help",

    rules: "Rules",

    gameRules: "Complete any 2 lines to win.",

    automatic: "Automatic calling",

    room: "Room",

    copied: "Copied",

    copy: "Copy",

    refresh: "Refresh",

    noGame: "Waiting for the next game",

    admin: "Admin",

    inventory: "Cards",

    users: "Users",

    activity: "Activity",

    system: "System",

    host: "Host controls",

    start: "Start",

    call: "Call",

    pause: "Pause",

    reset: "Reset",

    finish: "Finish",

    loading: "Loading…",

    retry: "Try again",

    normal: "NORMAL",

    vip: "VIP",

    vvip: "VVIP",

  },

  am: {

    bingo: "ቢንጎ",

    play: "ተጫወት",

    live: "ቀጥታ",

    lobby: "መጠባበቂያ",

    waiting: "ተጫዋቾችን በመጠበቅ ላይ",

    startsIn: "የሚጀምረው በ",

    players: "ተጫዋቾች",

    card: "ካርድ",

    cards: "ካርዶች",

    balance: "ቀሪ ሂሳብ",

    wallet: "ቦርሳ",

    called: "የተጠሩ",

    latest: "የመጨረሻ",

    next: "ቀጣይ",

    voice: "ድምጽ",

    voiceOn: "ድምጽ ክፍት",

    voiceOff: "ድምጽ ዝግ",

    chooseCard: "ካርድዎን ይምረጡ",

    selected: "ተመርጧል",

    choose: "ምረጥ",

    free: "ነፃ",

    prizePool: "የሽልማት ገንዘብ",

    price: "ዋጋ",

    winner: "አሸናፊ",

    winners: "አሸናፊዎች",

    congratulations: "እንኳን ደስ አለዎት!",

    twoLines: "2 መስመሮች ተሞልተዋል",

    waitingNumber: "የመጀመሪያውን ቁጥር በመጠበቅ ላይ",

    numbersCalled: "ቁጥሮች ተጠርተዋል",

    roundFinished: "ዙሩ ተጠናቋል",

    playAgain: "እንደገና ተጫወት",

    back: "ተመለስ",

    deposit: "ገቢ ማድረግ",

    withdraw: "ወጪ ማድረግ",

    amount: "መጠን",

    method: "ዘዴ",

    submit: "ላክ",

    transactions: "የእንቅስቃሴ ታሪክ",

    noTransactions: "እስካሁን እንቅስቃሴ የለም።",

    help: "እርዳታ",

    rules: "ደንቦች",

    gameRules: "ለማሸነፍ 2 መስመሮችን ሙላ።",

    automatic: "ራስ-ሰር ጥሪ",

    room: "ክፍል",

    copied: "ተቀድቷል",

    copy: "ቅዳ",

    refresh: "አድስ",

    noGame: "ቀጣዩን ጨዋታ በመጠበቅ ላይ",

    admin: "አስተዳደር",

    inventory: "ካርዶች",

    users: "ተጠቃሚዎች",

    activity: "እንቅስቃሴ",

    system: "ስርዓት",

    host: "የአስተናጋጅ ቁጥጥር",

    start: "ጀምር",

    call: "ጥራ",

    pause: "አቁም",

    reset: "ዳግም ጀምር",

    finish: "ጨርስ",

    loading: "በመጫን ላይ…",

    retry: "እንደገና ሞክር",

    normal: "መደበኛ",

    vip: "VIP",

    vvip: "VVIP",

  },

} as const;

function money(amount: number, currency = "ETB") {

  return `${currency} ${amount.toLocaleString(undefined, {

    minimumFractionDigits: 2,

    maximumFractionDigits: 2,

  })}`;

}

function ErrorState({

  onRetry,

  text,

}: {

  onRetry?: () => void;

  text?: string;

}) {

  return (

    <div className="mx-3 mt-5 rounded-3xl border border-dashed border-border bg-card p-8 text-center shadow-sm">

      <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">

        <RefreshCw size={18} />

      </div>

      <p className="text-sm text-muted-foreground">

        {text ?? "Something interrupted the live feed."}

      </p>

      {onRetry && (

        <button

          onClick={onRetry}

          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-sm font-bold text-background"

        >

          <RefreshCw size={14} />

          Try again

        </button>

      )}

    </div>

  );

}

function LoadingState() {

  return (

    <div className="space-y-3 p-4">

      <div className="h-24 animate-pulse rounded-3xl bg-muted" />

      <div className="h-72 animate-pulse rounded-3xl bg-muted" />

      <div className="h-28 animate-pulse rounded-3xl bg-muted" />

    </div>

  );

}

function Header({

  lang,

  setLang,

}: {

  lang: Language;

  setLang: (lang: Language) => void;

}) {

  const t = copy[lang];

  const [location, setLocation] = useLocation();

  return (

    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/90 backdrop-blur-xl">

      <div className="mx-auto flex h-[60px] max-w-2xl items-center justify-between px-4">

        <button

          onClick={() => setLocation("/")}

          className="flex items-center gap-2.5"

        >

          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">

            <Zap size={18} fill="currentColor" />

          </div>

          <div className="text-left">

            <div className="text-sm font-black">Fast Bingo</div>

            <div className="text-[9px] font-bold uppercase tracking-[.18em] text-muted-foreground">

              {location === "/wallet" ? t.wallet : t.bingo}

            </div>

          </div>

        </button>

        <div className="flex items-center gap-2">

          <button

            onClick={() =>

              setLang(lang === "am" ? "en" : "am")

            }

            className="rounded-xl border border-border bg-card px-3 py-1.5 text-[11px] font-black"

          >

            {lang === "am" ? "EN" : "አማ"}

          </button>

          <button

            onClick={() => setLocation("/wallet")}

            className={`flex size-9 items-center justify-center rounded-xl border ${

              location === "/wallet"

                ? "border-primary bg-primary/10 text-primary"

                : "border-border bg-card"

            }`}

          >

            <WalletCards size={17} />

          </button>

        </div>

      </div>

    </header>

  );

}

function BottomNav({ lang }: { lang: Language }) {

  const t = copy[lang];

  const [location, setLocation] = useLocation();

  return (

    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/95 px-4 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl">

      <div className="mx-auto flex max-w-2xl items-center justify-around">

        <button

          onClick={() => setLocation("/")}

          className={`flex min-w-16 flex-col items-center gap-1 rounded-xl py-1.5 text-[10px] font-bold ${

            location === "/"

              ? "text-primary"

              : "text-muted-foreground"

          }`}

        >

          <Ticket size={19} />

          <span>{t.play}</span>

        </button>

        <button

          onClick={() => setLocation("/wallet")}

          className={`flex min-w-16 flex-col items-center gap-1 rounded-xl py-1.5 text-[10px] font-bold ${

            location === "/wallet"

              ? "text-primary"

              : "text-muted-foreground"

          }`}

        >

          <WalletCards size={19} />

          <span>{t.wallet}</span>

        </button>

        <button

          onClick={() => setLocation("/rules")}

          className={`flex min-w-16 flex-col items-center gap-1 rounded-xl py-1.5 text-[10px] font-bold ${

            location === "/rules"

              ? "text-primary"

              : "text-muted-foreground"

          }`}

        >

          <HelpCircle size={19} />

          <span>{t.help}</span>

        </button>

      </div>

    </nav>

  );

}

function BingoHeader() {

  return (

    <div className="grid grid-cols-5 overflow-hidden rounded-t-2xl bg-foreground text-center text-sm font-black text-background">

      {["B", "I", "N", "G", "O"].map((letter) => (

        <div key={letter} className="py-3">

          {letter}

        </div>

      ))}

    </div>

  );

}

function bingoColumn(number: number) {

  if (number <= 15) return "B";

  if (number <= 30) return "I";

  if (number <= 45) return "N";

  if (number <= 60) return "G";

  return "O";

}

function getCompletedLines(

  numbers: number[],

  called: number[],

) {

  const calledSet = new Set(called);

  const marked = numbers.map(

    (number, index) =>

      index === 12 || calledSet.has(number),

  );

  const lines = [

    [0, 1, 2, 3, 4],

    [5, 6, 7, 8, 9],

    [10, 11, 12, 13, 14],

    [15, 16, 17, 18, 19],

    [20, 21, 22, 23, 24],

    [0, 5, 10, 15, 20],

    [1, 6, 11, 16, 21],

    [2, 7, 12, 17, 22],

    [3, 8, 13, 18, 23],

    [4, 9, 14, 19, 24],

    [0, 6, 12, 18, 24],

    [4, 8, 12, 16, 20],

  ];

  return lines.filter((line) =>

    line.every((index) => marked[index]),

  );

}

function BingoCardView({

  card,

  called,

  lang,

  large = true,

}: {

  card?: BingoCard;

  called: number[];

  lang: Language;

  large?: boolean;

}) {

  const t = copy[lang];

  const fallback = Array.from(

    { length: 25 },

    (_, i) => i + 1,

  );

  const numbers =

    card?.numbers?.length === 25

      ? card.numbers

      : fallback;

  const calledSet = new Set(called);

  const completedLines = getCompletedLines(

    numbers,

    called,

  );

  const completedCells = new Set(

    completedLines.flat(),

  );

  return (

    <div

      className={`overflow-hidden rounded-2xl border-2 border-border bg-border shadow-xl ${

        large ? "w-full" : ""

      }`}

    >

      <BingoHeader />

      <div className="grid grid-cols-5 gap-px">

        {numbers.map((number, index) => {

          const free = index === 12;

          const marked =

            free || calledSet.has(number);

          const completed =

            completedCells.has(index);

          return (

            <div

              key={`${number}-${index}`}

              className={`relative flex aspect-square items-center justify-center bg-card font-black transition-all ${

                large

                  ? "text-[clamp(18px,6vw,28px)]"

                  : "text-sm"

              } ${

                marked

                  ? "bg-primary/10 text-primary"

                  : "text-foreground"

              } ${

                completed

                  ? "ring-2 ring-inset ring-primary"

                  : ""

              }`}

            >

              {free ? (

                <span className="text-[9px] font-black uppercase tracking-wider">

                  {t.free}

                </span>

              ) : (

                number

              )}

              {marked && !free && (

                <span className="absolute inset-[17%] rounded-full border-[2px] border-primary/50" />

              )}

            </div>

          );

        })}

      </div>

    </div>

  );

}

function NumberBall({

  number,

  active = false,

}: {

  number: number;

  active?: boolean;

}) {

  return (

    <div

      className={`flex size-11 items-center justify-center rounded-full text-[11px] font-black shadow-sm ${

        active

          ? "bg-primary text-primary-foreground"

          : "bg-muted text-foreground"

      }`}

    >

      {bingoColumn(number)}

      {number}

    </div>

  );

}

function CalledNumbers({

  numbers,

  lang,

}: {

  numbers: number[];

  lang: Language;

}) {

  const t = copy[lang];

  const latest =

    numbers.length > 0

      ? numbers[numbers.length - 1]

      : undefined;

  return (

    <section className="rounded-3xl border border-border bg-card p-4 shadow-sm">

      <div className="flex items-center justify-between">

        <div>

          <div className="text-[9px] font-black uppercase tracking-[.18em] text-primary">

            {t.called}

          </div>

          <div className="mt-1 text-lg font-black">

            {latest

              ? `${bingoColumn(latest)}${latest}`

              : t.waitingNumber}

          </div>

        </div>

        {latest && (

          <div className="relative flex size-16 items-center justify-center rounded-full bg-primary text-2xl font-black text-primary-foreground shadow-lg">

            {latest}

          </div>

        )}

      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">

        {numbers

          .slice()

          .reverse()

          .map((number, index) => (

            <NumberBall

              key={`${number}-${index}`}

              number={number}

              active={index === 0}

            />

          ))}

      </div>

    </section>

  );

}

function useCountdown(

  value: number | null | undefined,

  active: boolean,

) {

  const [seconds, setSeconds] = useState(

    Math.max(0, Math.ceil(value ?? 0)),

  );

  useEffect(() => {

    setSeconds(

      Math.max(0, Math.ceil(value ?? 0)),

    );

    if (!active) return;

    const timer = window.setInterval(() => {

      setSeconds((current) =>

        Math.max(0, current - 1),

      );

    }, 1000);

    return () =>

      window.clearInterval(timer);

  }, [value, active]);

  return seconds;

}

function speakNumber(

  number: number,

  language: Language,

) {

  if (

    typeof window === "undefined" ||

    !("speechSynthesis" in window)

  ) {

    return;

  }

  window.speechSynthesis.cancel();

  const utterance =

    new SpeechSynthesisUtterance(

      `${bingoColumn(number)} ${number}`,

    );

  utterance.rate = 0.82;

  utterance.pitch = 1;

  utterance.volume = 1;

  if (language === "am") {

    utterance.lang = "am-ET";

    const voices =

      window.speechSynthesis.getVoices();

    const amharic = voices.find((voice) =>

      voice.lang

        .toLowerCase()

        .startsWith("am"),

    );

    if (amharic) {

      utterance.voice = amharic;

      utterance.lang = amharic.lang;

    }

  } else {

    utterance.lang = "en-US";

  }

  window.speechSynthesis.speak(utterance);

}

function GameTopBar({

  lang,

  voiceEnabled,

  setVoiceEnabled,

  shareCode,

}: {

  lang: Language;

  voiceEnabled: boolean;

  setVoiceEnabled: (value: boolean) => void;

  shareCode?: string;

}) {

  const t = copy[lang];

  const [copied, setCopied] =

    useState(false);

  const copyCode = async () => {

    if (!shareCode) return;

    try {

      await navigator.clipboard?.writeText(

        shareCode,

      );

      setCopied(true);

      window.setTimeout(

        () => setCopied(false),

        1500,

      );

    } catch {}

  };

  return (

    <div className="mb-3 flex items-center justify-between">

      <div className="flex items-center gap-2">

        <span className="live-dot size-2.5 rounded-full bg-primary" />

        <span className="text-[10px] font-black uppercase tracking-[.18em]">

          {t.live}

        </span>

      </div>

      <div className="flex items-center gap-2">

        <button

          onClick={() =>

            setVoiceEnabled(!voiceEnabled)

          }

          className={`flex size-9 items-center justify-center rounded-xl border ${

            voiceEnabled

              ? "border-primary bg-primary/10 text-primary"

              : "border-border bg-card"

          }`}

        >

          {voiceEnabled ? (

            <Volume2 size={16} />

          ) : (

            <VolumeX size={16} />

          )}

        </button>

        <button

          onClick={copyCode}

          className="flex size-9 items-center justify-center rounded-xl border border-border bg-card"

        >

          {copied ? (

            <Check size={16} />

          ) : (

            <Copy size={16} />

          )}

        </button>

      </div>

    </div>

  );

}

function GameHero({

  game,

  lang,

  countdown,

}: {

  game: BingoGame;

  lang: Language;

  countdown: number;

}) {

  const t = copy[lang];

  const latest =

    game.calledNumbers?.length

      ? game.calledNumbers[

          game.calledNumbers.length - 1

        ]

      : undefined;

  const waiting =

    game.status === "waiting";

  return (

    <section className="overflow-hidden rounded-[30px] bg-foreground p-5 text-background shadow-xl">

      <div className="flex items-start justify-between gap-3">

        <div className="min-w-0">

          <div className="flex items-center gap-2">

            <span

              className={`size-2 rounded-full ${

                waiting

                  ? "bg-accent"

                  : "bg-primary"

              }`}

            />

            <span className="text-[9px] font-black uppercase tracking-[.18em] text-background/55">

              {waiting

                ? t.lobby

                : t.live}

            </span>

          </div>

          <h1 className="mt-2 truncate text-2xl font-black">

            {game.name}

          </h1>

          <div className="mt-2 flex flex-wrap gap-2">

            {game.shareCode && (

              <span className="rounded-full bg-background/10 px-3 py-1 text-[10px] font-bold">

                {game.shareCode}

              </span>

            )}

            <span className="rounded-full bg-background/10 px-3 py-1 text-[10px] font-bold">

              {game.players.length}{" "}

              {t.players}

            </span>

          </div>

        </div>

        <div className="flex size-[68px] shrink-0 flex-col items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">

          <div className="text-[8px] font-black uppercase">

            {t.latest}

          </div>

          <div className="mt-0.5 text-2xl font-black">

            {latest ?? "—"}

          </div>

        </div>

      </div>

      <div className="mt-5 grid grid-cols-3 gap-2">

        <div className="rounded-2xl bg-background/10 p-3 text-center">

          <Users

            size={15}

            className="mx-auto text-primary"

          />

          <div className="mt-1 text-lg font-black">

            {game.players.length}

          </div>

          <div className="text-[8px] text-background/45">

            {t.players}

          </div>

        </div>

        <div className="rounded-2xl bg-background/10 p-3 text-center">

          <Ticket

            size={15}

            className="mx-auto text-primary"

          />

          <div className="mt-1 text-lg font-black">

            {game.calledNumbers.length}

          </div>

          <div className="text-[8px] text-background/45">

            {t.called}

          </div>

        </div>

        <div className="rounded-2xl bg-background/10 p-3 text-center">

          <Clock3

            size={15}

            className="mx-auto text-primary"

          />

          <div className="mt-1 text-lg font-black">

            {countdown}s

          </div>

          <div className="text-[8px] text-background/45">

            {waiting

              ? t.startsIn

              : t.next}

          </div>

        </div>

      </div>

    </section>

  );

}

function CardSelector({

  cards,

  selectedCardId,

  onSelect,

  lang,

}: {

  cards: BingoCard[];

  selectedCardId?: string;

  onSelect: (id: string) => void;

  lang: Language;

}) {

  const t = copy[lang];

  const available = cards

    .filter(

      (card) =>

        card.status === "available" ||

        card.id === selectedCardId,

    )

    .slice(0, 24);

  if (!available.length) {

    return (

      <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">

        {t.waitingNumber}

      </div>

    );

  }

  return (

    <div className="grid grid-cols-2 gap-2">

      {available.map((card) => {

        const selected =

          selectedCardId === card.id;

        return (

          <button

            key={card.id}

            onClick={() =>

              onSelect(card.id)

            }

            className={`rounded-2xl border p-3 text-left transition-all ${

              selected

                ? "border-primary bg-primary/10 ring-2 ring-primary/20"

                : "border-border bg-card"

            }`}

          >

            <div className="flex items-center justify-between">

              <div className="flex size-8 items-center justify-center rounded-xl bg-muted">

                <Ticket size={15} />

              </div>

              {selected && (

                <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">

                  <Check size={13} />

                </span>

              )}

            </div>

            <div className="mt-3 text-sm font-black">

              {card.label}

            </div>

            <div className="mt-1 text-[9px] font-bold uppercase text-muted-foreground">

              {card.category === "vvip"

                ? t.vvip

                : card.category === "vip"

                  ? t.vip

                  : t.normal}

            </div>

          </button>

        );

      })}

    </div>

  );

}

function GameScreen({

  lang,

  gameId,

}: {

  lang: Language;

  gameId: string;

}) {

  const t = copy[lang];

  const gameQuery =

    useGetBingoGame(gameId);

  const cardsQuery =

    useListBingoCards();

  const advance =

    useAdvanceBingoGame();

  const client = useQueryClient();

  const [voiceEnabled, setVoiceEnabled] =

    useState(true);

  const [selectedCardId, setSelectedCardId] =

    useState<string>();

  const previousCalls =

    useRef<number[]>([]);

  useEffect(() => {

    const interval =

      window.setInterval(() => {

        void gameQuery.refetch();

      }, 1000);

    return () =>

      window.clearInterval(interval);

  }, [gameQuery.refetch]);

  useEffect(() => {

    const current =

      gameQuery.data?.calledNumbers ?? [];

    const previous =

      previousCalls.current;

    if (

      voiceEnabled &&

      current.length > previous.length &&

      previous.length > 0

    ) {

      const latest =

        current[current.length - 1];

      if (!previous.includes(latest)) {

        speakNumber(latest, lang);

      }

    }

    previousCalls.current = [...current];

  }, [

    gameQuery.data?.calledNumbers,

    voiceEnabled,

    lang,

  ]);

  const game = gameQuery.data;

  const cards = cardsQuery.data ?? [];

  const countdown = useCountdown(

    game?.nextCallIn,

    game?.status === "waiting" ||

      game?.status === "live",

  );

  const selectedCard = useMemo(() => {

    if (selectedCardId) {

      return (

        cards.find(

          (card) =>

            card.id === selectedCardId,

        ) ??

        cards.find(

          (card) =>

            card.status === "in-play",

        ) ??

        cards[0]

      );

    }

    return (

      cards.find(

        (card) =>

          card.status === "in-play",

      ) ?? cards[0]

    );

  }, [cards, selectedCardId]);

  const completedLines = useMemo(() => {

    if (!selectedCard?.numbers?.length) {

      return [];

    }

    return getCompletedLines(

      selectedCard.numbers,

      game?.calledNumbers ?? [],

    );

  }, [

    selectedCard,

    game?.calledNumbers,

  ]);

  const hasWon =

    completedLines.length >= 2;

  const prizePool =

    (game?.players?.length ?? 0) *

    PRIZE_PER_CARD;

  const refreshAll = () => {

    if (!game) return;

    client.invalidateQueries({

      queryKey:

        getGetBingoGameQueryKey(

          game.id,

        ),

    });

    client.invalidateQueries({

      queryKey:

        getListBingoGamesQueryKey(),

    });

    client.invalidateQueries({

      queryKey:

        getGetBingoOverviewQueryKey(),

    });

    client.invalidateQueries({

      queryKey:

        getGetBingoWalletQueryKey(),

    });

  };

  if (

    gameQuery.isLoading ||

    cardsQuery.isLoading

  ) {

    return <LoadingState />;

  }

  if (

    gameQuery.isError ||

    !game

  ) {

    return (

      <ErrorState

        onRetry={() =>

          gameQuery.refetch()

        }

      />

    );

  }

  const waiting =

    game.status === "waiting";

  const live =

    game.status === "live";

  const completed =

    game.status === "completed";

  return (

    <div className="mx-auto max-w-2xl px-3 pb-8 pt-3">

      <GameTopBar

        lang={lang}

        voiceEnabled={voiceEnabled}

        setVoiceEnabled={

          setVoiceEnabled

        }

        shareCode={

          game.shareCode

        }

      />

      <GameHero

        game={game}

        lang={lang}

        countdown={countdown}

      />

      {waiting && (

        <section className="mt-4 overflow-hidden rounded-3xl border border-border bg-card shadow-sm">

          <div className="bg-primary p-5 text-primary-foreground">

            <div className="flex items-center justify-between gap-4">

              <div>

                <div className="text-[9px] font-black uppercase tracking-[.18em] opacity-70">

                  {t.lobby}

                </div>

                <div className="mt-1 text-xl font-black">

                  {t.waiting}

                </div>

                <div className="mt-1 text-xs opacity-70">

                  {t.startsIn}{" "}

                  {countdown}s

                </div>

              </div>

              <div className="flex size-[68px] items-center justify-center rounded-2xl bg-primary-foreground/15 text-3xl font-black">

                {countdown}

              </div>

            </div>

          </div>

          <div className="grid grid-cols-3 divide-x divide-border">

            <div className="p-4 text-center">

              <div className="text-[9px] text-muted-foreground">

                {t.players}

              </div>

              <div className="mt-1 text-xl font-black">

                {game.players.length}

              </div>

            </div>

            <div className="p-4 text-center">

              <div className="text-[9px] text-muted-foreground">

                {t.price}

              </div>

              <div className="mt-1 text-xl font-black">

                {CARD_PRICE}

              </div>

              <div className="text-[9px] text-muted-foreground">

                ETB

              </div>

            </div>

            <div className="p-4 text-center">

              <div className="text-[9px] text-muted-foreground">

                {t.prizePool}

              </div>

              <div className="mt-1 text-xl font-black text-primary">

                {prizePool}

              </div>

              <div className="text-[9px] text-muted-foreground">

                ETB

              </div>

            </div>

          </div>

        </section>

      )}

      {waiting && (

        <section className="mt-4 rounded-3xl border border-border bg-card p-4 shadow-sm">

          <div className="mb-4 flex items-center justify-between">

            <div>

              <div className="text-[9px] font-black uppercase tracking-[.18em] text-primary">

                {t.cards}

              </div>

              <h2 className="mt-1 text-xl font-black">

                {t.chooseCard}

              </h2>

            </div>

            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">

              <Ticket size={19} />

            </div>

          </div>

          <CardSelector

            cards={cards}

            selectedCardId={

              selectedCardId

            }

            onSelect={

              setSelectedCardId

            }

            lang={lang}

          />

          <div className="mt-3 flex items-center justify-between rounded-2xl bg-muted p-3">

            <span className="text-[10px] font-bold text-muted-foreground">

              {t.price}

            </span>

            <span className="text-sm font-black">

              {CARD_PRICE} ETB

            </span>

          </div>

        </section>

      )}

      {live && (

        <div className="mt-4 rounded-3xl border border-primary/20 bg-primary/5 p-4">

          <div className="flex items-center gap-3">

            <div className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">

              <Sparkles size={20} />

            </div>

            <div className="min-w-0 flex-1">

              <div className="text-[9px] font-black uppercase tracking-[.18em] text-primary">

                {t.automatic}

              </div>

              <div className="mt-1 text-sm font-black">

                {t.called}

              </div>

            </div>

            <div className="text-right">

              <div className="text-2xl font-black">

                {countdown}s

              </div>

              <div className="text-[8px] text-muted-foreground">

                {t.next}

              </div>

            </div>

          </div>

        </div>

      )}

      <section className="mt-4">

        <div className="mb-3 flex items-end justify-between px-1">

          <div>

            <div className="text-[9px] font-black uppercase tracking-[.18em] text-primary">

              {t.card}

            </div>

            <h2 className="mt-1 text-xl font-black">

              {selectedCard?.label ??

                "Bingo Card"}

            </h2>

          </div>

          {selectedCard && (

            <span className="rounded-full bg-muted px-3 py-1 text-[9px] font-black uppercase">

              {selectedCard.category}

            </span>

          )}

        </div>

        <BingoCardView

          card={selectedCard}

          called={

            game.calledNumbers

          }

          lang={lang}

        />

      </section>

      <div className="mt-4">

        <CalledNumbers

          numbers={

            game.calledNumbers

          }

          lang={lang}

        />

      </div>

      {completedLines.length > 0 && (

        <section

          className={`mt-4 rounded-3xl border p-5 shadow-sm ${

            hasWon

              ? "border-primary bg-primary/10"

              : "border-border bg-card"

          }`}

        >

          <div className="flex items-center gap-3">

            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">

              <Trophy size={23} />

            </div>

            <div>

              <div className="text-[9px] font-black uppercase tracking-[.18em] text-primary">

                {hasWon

                  ? t.winner

                  : t.bingo}

              </div>

              <div className="mt-1 text-lg font-black">

                {hasWon

                  ? t.congratulations

                  : `${completedLines.length} ${t.twoLines}`}

              </div>

            </div>

          </div>

          {hasWon && (

            <div className="mt-4 rounded-2xl bg-card p-4">

              <div className="text-[10px] text-muted-foreground">

                {t.prizePool}

              </div>

              <div className="mt-1 text-2xl font-black text-primary">

                {money(prizePool)}

              </div>

            </div>

          )}

        </section>

      )}

      {completed && (

        <section className="mt-4 rounded-3xl border border-primary/20 bg-primary/10 p-5">

          <div className="flex items-center gap-3">

            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">

              <Trophy size={22} />

            </div>

            <div>

              <div className="text-xl font-black">

                {t.roundFinished}

              </div>

              <div className="text-sm text-muted-foreground">

                {game.winnerCount}{" "}

                {t.winners}

              </div>

            </div>

          </div>

          <button

            onClick={() => {

              refreshAll();

              window.location.href =

                "/";

            }}

            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-black text-primary-foreground"

          >

            <RefreshCw size={16} />

            {t.playAgain}

          </button>

        </section>

      )}

      {game.players.length > 0 && (

        <section className="mt-4 rounded-3xl bg-foreground p-5 text-background">

          <div className="mb-4 flex items-center justify-between">

            <div className="flex items-center gap-2">

              <Users

                size={17}

                className="text-primary"

              />

              <span className="text-[9px] font-black uppercase tracking-[.18em] text-background/50">

                {t.players}

              </span>

            </div>

            <span className="rounded-full bg-background/10 px-2.5 py-1 text-[9px] font-black">

              {game.players.length}

            </span>

          </div>

          <div className="space-y-2">

            {game.players

              .slice(0, 12)

              .map((player) => (

                <div

                  key={player.id}

                  className="flex items-center gap-3 rounded-2xl bg-background/5 p-2.5"

                >

                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background/10 text-[9px] font-black">

                    {player.initials}

                  </div>

                  <div className="min-w-0 flex-1 truncate text-xs font-semibold">

                    {player.name}

                  </div>

                  <div className="rounded-full bg-background/10 px-2 py-1 text-[8px] text-background/50">

                    {player.cardLabel}

                  </div>

                </div>

              ))}

          </div>

        </section>

      )}

    </div>

  );

}

function GameLobby() {

  const games = useListBingoGames();

  const [, setLocation] =

    useLocation();

  const [checking, setChecking] =

    useState(true);

  useEffect(() => {

    const interval =

      window.setInterval(() => {

        void games.refetch();

      }, 1500);

    return () =>

      window.clearInterval(interval);

  }, [games.refetch]);

  const activeGame = useMemo(() => {

    const list = games.data ?? [];

    return (

      list.find(

        (game) =>

          game.status === "live",

      ) ??

      list.find(

        (game) =>

          game.status === "waiting",

      ) ??

      null

    );

  }, [games.data]);

  useEffect(() => {

    if (activeGame) {

      setChecking(false);

      setLocation(

        `/play/${activeGame.id}`,

      );

    }

  }, [activeGame, setLocation]);

  if (

    games.isLoading ||

    checking

  ) {

    return (

      <div className="mx-auto max-w-2xl px-4 pb-28 pt-6">

        <div className="rounded-[32px] bg-foreground p-7 text-background shadow-xl">

          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">

            <Ticket size={28} />

          </div>

          <h1 className="mt-6 text-3xl font-black">

            Fast Bingo

          </h1>

          <p className="mt-2 text-sm text-background/50">

            Loading…

          </p>

          <div className="mt-7 h-2 overflow-hidden rounded-full bg-background/10">

            <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />

          </div>

        </div>

      </div>

    );

  }

  if (games.isError) {

    return (

      <ErrorState

        onRetry={() =>

          games.refetch()

        }

      />

    );

  }

  return (

    <div className="mx-auto max-w-2xl px-4 pb-28 pt-6">

      <section className="overflow-hidden rounded-[32px] bg-foreground p-6 text-background shadow-xl">

        <div className="flex items-center justify-between">

          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">

            <Ticket size={27} />

          </div>

          <span className="rounded-full bg-background/10 px-3 py-1.5 text-[9px] font-black uppercase tracking-wider">

            LIVE

          </span>

        </div>

        <h1 className="mt-7 text-3xl font-black">

          Fast Bingo

        </h1>

        <p className="mt-2 text-sm text-background/50">

          75-ball Bingo

        </p>

        <div className="mt-7 grid grid-cols-5 gap-2">

          {["B", "I", "N", "G", "O"].map(

            (letter) => (

              <div

                key={letter}

                className="flex aspect-square items-center justify-center rounded-2xl bg-background/10 text-xl font-black"

              >

                {letter}

              </div>

            ),

          )}

        </div>

        <div className="mt-5 flex items-center gap-3 rounded-2xl bg-background/10 p-4">

          <RefreshCw

            size={17}

            className="animate-spin text-primary"

          />

          <span className="text-sm font-semibold">

            Waiting for the next game…

          </span>

        </div>

      </section>

    </div>

  );

}

function HomePage({

  lang,

}: {

  lang: Language;

}) {

  const t = copy[lang];

  const overview =

    useGetBingoOverview();

  const wallet =

    useGetBingoWallet();

  const [, setLocation] =

    useLocation();

  if (

    overview.isLoading ||

    wallet.isLoading

  ) {

    return <LoadingState />;

  }

  if (

    overview.isError ||

    wallet.isError

  ) {

    return (

      <ErrorState

        onRetry={() => {

          overview.refetch();

          wallet.refetch();

        }}

      />

    );

  }

  const balance =

    wallet.data?.balance ??

    overview.data?.demoBalance ??

    0;

  return (

    <div className="mx-auto max-w-2xl px-4 pb-28 pt-5">

      <section className="overflow-hidden rounded-[32px] bg-primary p-6 text-primary-foreground shadow-xl">

        <div className="flex items-start justify-between">

          <div>

            <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[.2em] opacity-75">

              <span className="live-dot size-2 rounded-full bg-current" />

              {t.live}

            </div>

            <h1 className="mt-2 text-3xl font-black">

              Fast Bingo

            </h1>

            <p className="mt-1 text-sm opacity-70">

              75-ball Bingo

            </p>

          </div>

          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary-foreground/15">

            <Zap

              size={22}

              fill="currentColor"

            />

          </div>

        </div>

        <div className="mt-7 grid grid-cols-5 gap-2">

          {["B", "I", "N", "G", "O"].map(

            (letter) => (

              <div

                key={letter}

                className="flex aspect-square items-center justify-center rounded-2xl bg-primary-foreground/15 text-xl font-black"

              >

                {letter}

              </div>

            ),

          )}

        </div>

        <button

          onClick={() =>

            setLocation("/play")

          }

          className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary-foreground text-sm font-black text-primary shadow-sm"

        >

          <Play

            size={18}

            fill="currentColor"

          />

          {t.play}

        </button>

      </section>

      <div className="mt-4 grid grid-cols-2 gap-3">

        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">

          <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">

            <WalletCards size={14} />

            {t.balance}

          </div>

          <div className="mt-2 text-xl font-black">

            {money(

              balance,

              wallet.data?.currency,

            )}

          </div>

        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">

          <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">

            <Users size={14} />

            {t.players}

          </div>

          <div className="mt-2 text-xl font-black">

            {overview.data

              ?.playersOnline ?? 0}

          </div>

        </div>

      </div>

      <section className="mt-4 rounded-3xl border border-border bg-card p-5 shadow-sm">

        <div className="flex items-center justify-between">

          <div>

            <div className="text-[9px] font-black uppercase tracking-[.18em] text-primary">

              {t.rules}

            </div>

            <h2 className="mt-1 text-xl font-black">

              {t.gameRules}

            </h2>

          </div>

          <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">

            <Trophy size={21} />

          </div>

        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">

          <div className="rounded-2xl bg-muted p-3 text-center">

            <div className="text-lg font-black">

              {CARD_PRICE}

            </div>

            <div className="text-[8px] text-muted-foreground">

              ETB / CARD

            </div>

          </div>

          <div className="rounded-2xl bg-muted p-3 text-center">

            <div className="text-lg font-black">

              75

            </div>

            <div className="text-[8px] text-muted-foreground">

              NUMBERS

            </div>

          </div>

          <div className="rounded-2xl bg-muted p-3 text-center">

            <div className="text-lg font-black">

              2

            </div>

            <div className="text-[8px] text-muted-foreground">

              LINES

            </div>

          </div>

        </div>

      </section>

      <section className="mt-4 rounded-3xl border border-border bg-card p-5">

        <div className="flex items-center gap-3">

          <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">

            <Sparkles size={20} />

          </div>

          <div>

            <div className="font-black">

              {t.automatic}

            </div>

            <div className="text-xs text-muted-foreground">

              3.5 second calling interval

            </div>

          </div>

        </div>

      </section>

    </div>

  );

}

function WalletPage({

  lang,

}: {

  lang: Language;

}) {

  const t = copy[lang];

  const wallet =

    useGetBingoWallet();

  const action =

    useSubmitBingoWalletAction();

  const client = useQueryClient();

  const [type, setType] =

    useState<

      "deposit" | "withdrawal"

    >("deposit");

  const [method, setMethod] =

    useState<

      "telebirr" | "ebirr" | "mpesa"

    >("telebirr");

  const [amount, setAmount] =

    useState("25");

  if (wallet.isLoading) {

    return <LoadingState />;

  }

  if (

    wallet.isError ||

    !wallet.data

  ) {

    return (

      <ErrorState

        onRetry={() =>

          wallet.refetch()

        }

      />

    );

  }

  const data = wallet.data;

  const submit = () => {

    const value = Number(amount);

    if (!value || value < 1) return;

    action.mutate(

      {

        data: {

          type,

          method,

          amount: value,

        },

      },

      {

        onSuccess: () => {

          client.invalidateQueries({

            queryKey:

              getGetBingoWalletQueryKey(),

          });

        },

      },

    );

  };

  return (

    <div className="mx-auto max-w-2xl px-4 pb-28 pt-5">

      <section className="rounded-[32px] bg-foreground p-6 text-background shadow-xl">

        <div className="flex items-center justify-between">

          <div>

            <div className="text-[9px] font-black uppercase tracking-[.18em] text-background/45">

              {t.wallet}

            </div>

            <div className="mt-2 text-3xl font-black">

              {money(

                data.balance,

                data.currency,

              )}

            </div>

          </div>

          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">

            <WalletCards size={22} />

          </div>

        </div>

        <div className="mt-6 grid grid-cols-2 gap-2">

          <button

            onClick={() =>

              setType("deposit")

            }

            className={`rounded-2xl p-4 text-left text-xs font-black ${

              type === "deposit"

                ? "bg-primary text-primary-foreground"

                : "bg-background/10"

            }`}

          >

            <ArrowDownLeft

              size={17}

              className="mb-2"

            />

            {t.deposit}

          </button>

          <button

            onClick={() =>

              setType("withdrawal")

            }

            className={`rounded-2xl p-4 text-left text-xs font-black ${

              type === "withdrawal"

                ? "bg-primary text-primary-foreground"

                : "bg-background/10"

            }`}

          >

            <ArrowUpRight

              size={17}

              className="mb-2"

            />

            {t.withdraw}

          </button>

        </div>

      </section>

      <section className="mt-4 rounded-3xl border border-border bg-card p-5 shadow-sm">

        <h2 className="text-xl font-black">

          {type === "deposit"

            ? t.deposit

            : t.withdraw}

        </h2>

        <div className="mt-5">

          <label className="text-xs font-bold text-muted-foreground">

            {t.amount}

          </label>

          <div className="mt-2 flex items-center rounded-2xl border border-input bg-background px-4">

            <span className="text-sm font-bold text-muted-foreground">

              {data.currency}

            </span>

            <input

              inputMode="decimal"

              value={amount}

              onChange={(event) =>

                setAmount(

                  event.target.value,

                )

              }

              className="h-12 w-full bg-transparent px-3 text-lg font-black outline-none"

            />

          </div>

        </div>

        <div className="mt-5">

          <div className="text-xs font-bold text-muted-foreground">

            {t.method}

          </div>

          <div className="mt-2 grid grid-cols-3 gap-2">

            {(

              [

                "telebirr",

                "ebirr",

                "mpesa",

              ] as const

            ).map((item) => (

              <button

                key={item}

                onClick={() =>

                  setMethod(item)

                }

                className={`rounded-2xl border p-3 text-xs font-black ${

                  method === item

                    ? "border-primary bg-primary/10 text-primary"

                    : "border-border"

                }`}

              >

                {item}

              </button>

            ))}

          </div>

        </div>

        <button

          disabled={action.isPending}

          onClick={submit}

          className="mt-5 h-12 w-full rounded-2xl bg-primary text-sm font-black text-primary-foreground disabled:opacity-50"

        >

          {action.isPending

            ? "..."

            : t.submit}

        </button>

        {action.isSuccess && (

          <div className="mt-3 rounded-2xl bg-secondary p-3 text-center text-xs font-bold text-secondary-foreground">

            <Check

              size={14}

              className="mr-1 inline"

            />

            {t.submit}

          </div>

        )}

      </section>

      <section className="mt-5 rounded-3xl border border-border bg-card shadow-sm">

        <div className="border-b border-border p-5">

          <h2 className="font-black">

            {t.transactions}

          </h2>

        </div>

        {data.entries?.length ? (

          data.entries.map(

            (

              entry: BingoWalletEntry,

            ) => (

              <div

                key={entry.id}

                className="flex items-center gap-3 border-b border-border p-4 last:border-0"

              >

                <div

                  className={`flex size-9 items-center justify-center rounded-xl ${

                    entry.type ===

                    "deposit"

                      ? "bg-secondary text-secondary-foreground"

                      : "bg-primary/10 text-primary"

                  }`}

                >

                  {entry.type ===

                  "deposit" ? (

                    <ArrowDownLeft

                      size={16}

                    />

                  ) : (

                    <ArrowUpRight

                      size={16}

                    />

                  )}

                </div>

                <div className="min-w-0 flex-1">

                  <div className="text-sm font-bold capitalize">

                    {entry.type}

                  </div>

                  <div className="text-[10px] text-muted-foreground">

                    {entry.method} ·{" "}

                    {entry.status}

                  </div>

                </div>

                <div className="text-right text-sm font-black">

                  {entry.type ===

                  "deposit"

                    ? "+"

                    : "-"}

                  {money(

                    entry.amount,

                    data.currency,

                  )}

                </div>

              </div>

            ),

          )

        ) : (

          <div className="p-7 text-center text-sm text-muted-foreground">

            {t.noTransactions}

          </div>

        )}

      </section>

    </div>

  );

}

function RulesPage({

  lang,

}: {

  lang: Language;

}) {

  const t = copy[lang];

  return (

    <div className="mx-auto max-w-2xl px-4 pb-28 pt-5">

      <section className="rounded-[32px] bg-foreground p-6 text-background shadow-xl">

        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">

          <HelpCircle size={23} />

        </div>

        <h1 className="mt-5 text-2xl font-black">

          {t.rules}

        </h1>

        <p className="mt-2 text-sm text-background/50">

          {t.gameRules}

        </p>

      </section>

      <div className="mt-4 space-y-3">

        {[

          [

            "B",

            "1 – 15",

          ],

          [

            "I",

            "16 – 30",

          ],

          [

            "N",

            "31 – 45",

          ],

          [

            "G",

            "46 – 60",

          ],

          [

            "O",

            "61 – 75",

          ],

        ].map(([letter, range]) => (

          <div

            key={letter}

            className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4"

          >

            <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-lg font-black text-primary-foreground">

              {letter}

            </div>

            <div className="text-sm font-bold">

              {range}

            </div>

          </div>

        ))}

        <div className="rounded-3xl border border-primary/20 bg-primary/5 p-5">

          <div className="flex items-center gap-3">

            <Trophy

              size={20}

              className="text-primary"

            />

            <div className="font-black">

              {t.gameRules}

            </div>

          </div>

          <p className="mt-3 text-xs leading-6 text-muted-foreground">

            Complete any two horizontal,

            vertical or diagonal lines.

            The center N space is FREE.

          </p>

        </div>

      </div>

    </div>

  );

}

function AdminPage({

  lang,

}: {

  lang: Language;

}) {

  const t = copy[lang];

  const admin =

    useGetBingoAdmin();

  const cards =

    useListBingoCards();

  const games =

    useListBingoGames();

  if (

    admin.isLoading ||

    cards.isLoading ||

    games.isLoading

  ) {

    return <LoadingState />;

  }

  if (

    admin.isError ||

    cards.isError ||

    games.isError ||

    !admin.data

  ) {

    return (

      <ErrorState

        onRetry={() => {

          admin.refetch();

          cards.refetch();

          games.refetch();

        }}

      />

    );

  }

  const data = admin.data;

  return (

    <div className="mx-auto max-w-2xl px-4 pb-28 pt-5">

      <section className="rounded-3xl bg-foreground p-6 text-background shadow-xl">

        <ShieldCheck

          size={26}

          className="text-primary"

        />

        <h1 className="mt-3 text-2xl font-black">

          {t.admin}

        </h1>

        <p className="mt-1 text-sm text-background/50">

          {t.system}

        </p>

      </section>

      <div className="mt-4 grid grid-cols-2 gap-3">

        <Stat

          icon={Users}

          label={t.users}

          value={data.totalUsers}

        />

        <Stat

          icon={Zap}

          label={t.live}

          value={data.activeGames}

        />

        <Stat

          icon={Ticket}

          label={t.inventory}

          value={

            cards.data?.length ?? 0

          }

        />

        <Stat

          icon={CircleDollarSign}

          label={t.activity}

          value={

            games.data?.length ?? 0

          }

        />

      </div>

      <section className="mt-4 rounded-3xl border border-border bg-card p-5 shadow-sm">

        <h2 className="font-black">

          {t.inventory}

        </h2>

        <div className="mt-4 space-y-2">

          {(cards.data ?? [])

            .slice(0, 30)

            .map((card) => (

              <div

                key={card.id}

                className="flex items-center gap-3 rounded-2xl bg-muted p-3"

              >

                <Ticket size={16} />

                <div className="min-w-0 flex-1">

                  <div className="truncate text-sm font-black">

                    {card.label}

                  </div>

                  <div className="text-[9px] uppercase text-muted-foreground">

                    {card.category}

                  </div>

                </div>

                <span className="rounded-full bg-background px-2 py-1 text-[8px] font-black">

                  {card.status}

                </span>

              </div>

            ))}

        </div>

      </section>

    </div>

  );

}

function Stat({

  icon: Icon,

  label,

  value,

}: {

  icon: typeof Users;

  label: string;

  value: ReactNode;

}) {

  return (

    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">

      <Icon

        size={16}

        className="text-primary"

      />

      <div className="mt-3 text-2xl font-black">

        {value}

      </div>

      <div className="mt-1 text-[10px] font-bold text-muted-foreground">

        {label}

      </div>

    </div>

  );

}

function HostControls({

  lang,

  game,

}: {

  lang: Language;

  game: BingoGame;

}) {

  const t = copy[lang];

  const advance =

    useAdvanceBingoGame();

  const client = useQueryClient();

  const call = (

    action: BingoGameActionAction,

  ) => {

    advance.mutate(

      {

        gameId: game.id,

        data: { action },

      },

      {

        onSuccess: () => {

          client.invalidateQueries({

            queryKey:

              getGetBingoGameQueryKey(

                game.id,

              ),

          });

          client.invalidateQueries({

            queryKey:

              getListBingoGamesQueryKey(),

          });

        },

      },

    );

  };

  return (

    <section className="mt-4 rounded-3xl border border-border bg-card p-5 shadow-sm">

      <div className="mb-4 flex items-center gap-2">

        <ShieldCheck

          size={17}

          className="text-primary"

        />

        <h2 className="font-black">

          {t.host}

        </h2>

      </div>

      <div className="grid grid-cols-2 gap-2">

        {game.status ===

          "waiting" && (

          <button

            onClick={() =>

              call("start")

            }

            disabled={

              advance.isPending

            }

            className="col-span-2 flex h-11 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-black text-primary-foreground disabled:opacity-50"

          >

            <Play

              size={16}

              fill="currentColor"

            />

            {t.start}

          </button>

        )}

        {game.status === "live" && (

          <>

            <button

              onClick={() =>

                call("call")

              }

              disabled={

                advance.isPending

              }

              className="col-span-2 flex h-11 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-black text-primary-foreground disabled:opacity-50"

            >

              <Zap size={16} />

              {t.call}

            </button>

            <button

              onClick={() =>

                call("pause")

              }

              disabled={

                advance.isPending

              }

              className="flex h-10 items-center justify-center gap-2 rounded-xl border border-border text-xs font-bold"

            >

              <Pause size={14} />

              {t.pause}

            </button>

            <button

              onClick={() =>

                call("claim")

              }

              disabled={

                advance.isPending

              }

              className="flex h-10 items-center justify-center gap-2 rounded-xl border border-border text-xs font-bold"

            >

              <Check size={14} />

              {t.finish}

            </button>

          </>

        )}

        {game.status !==

          "completed" && (

          <button

            onClick={() =>

              call("reset")

            }

            disabled={

              advance.isPending

            }

            className="col-span-2 flex h-10 items-center justify-center gap-2 rounded-xl border border-border text-xs font-bold"

          >

            <RefreshCw size={14} />

            {t.reset}

          </button>

        )}

      </div>

    </section>

  );

}

function GameRoute({

  lang,

}: {

  lang: Language;

}) {

  const params =

    useParams<{

      gameId: string;

    }>();

  return (

    <>

      <GameScreen

        lang={lang}

        gameId={params.gameId}

      />

      <HostRoute

        gameId={params.gameId}

        lang={lang}

      />

    </>

  );

}

function HostRoute({

  gameId,

  lang,

}: {

  gameId: string;

  lang: Language;

}) {

  const game =

    useGetBingoGame(gameId);

  if (

    game.isLoading ||

    game.isError ||

    !game.data

  ) {

    return null;

  }

  return (

    <div className="mx-auto max-w-2xl px-3 pb-28">

      <HostControls

        lang={lang}

        game={game.data}

      />

    </div>

  );

}

function Router({

  lang,

  setLang,

}: {

  lang: Language;

  setLang: (lang: Language) => void;

}) {

  const [location] =

    useLocation();

  const isGame =

    location.startsWith("/play/");

  return (

    <ErrorBoundary

      resetKey={location}

    >

      <div className="noise min-h-[100dvh] bg-background">

        {!isGame && (

          <Header

            lang={lang}

            setLang={setLang}

          />

        )}

        <Switch>

          <Route

            path="/"

            component={() => (

              <HomePage lang={lang} />

            )}

          />

          <Route

            path="/play"

            component={GameLobby}

          />

          <Route

            path="/play/:gameId"

            component={() => (

              <GameRoute

                lang={lang}

              />

            )}

          />

          <Route

            path="/wallet"

            component={() => (

              <WalletPage

                lang={lang}

              />

            )}

          />

          <Route

            path="/rules"

            component={() => (

              <RulesPage

                lang={lang}

              />

            )}

          />

          <Route

            path="/admin"

            component={() => (

              <AdminPage

                lang={lang}

              />

            )}

          />

          <Route

            component={NotFound}

          />

        </Switch>

        {!isGame && (

          <BottomNav lang={lang} />

        )}

      </div>

    </ErrorBoundary>

  );

}

function App() {

  const [lang, setLang] =

    useState<Language>(() => {

      if (

        typeof window !==

        "undefined"

      ) {

        const saved =

          localStorage.getItem(

            "fast-bingo-language",

          );

        if (

          saved === "en" ||

          saved === "am"

        ) {

          return saved;

        }

      }

      return "am";

    });

  useEffect(() => {

    localStorage.setItem(

      "fast-bingo-language",

      lang,

    );

  }, [lang]);

  useEffect(() => {

    if (

      typeof window !== "undefined" &&

      window.Telegram?.WebApp

    ) {

      const webApp =

        window.Telegram.WebApp;

      webApp.ready();

      webApp.expand();

      try {

        webApp.setHeaderColor(

          "#09090b",

        );

        webApp.setBackgroundColor(

          "#09090b",

        );

      } catch {}

    }

  }, []);

  return (

    <QueryClientProvider

      client={queryClient}

    >

      <TooltipProvider>

        <WouterRouter

          base={import.meta.env.BASE_URL.replace(

            /\/$/,

            "",

          )}

        >

          <Router

            lang={lang}

            setLang={setLang}

          />

        </WouterRouter>

        <Toaster />

      </TooltipProvider>

    </QueryClientProvider>

  );

}

export default App;