import { Router, type IRouter } from "express";
import {
  AdvanceBingoGameBody,
  AdvanceBingoGameParams,
  CreateBingoGameBody,
  GetBingoGameParams,
  SubmitBingoWalletActionBody,
  GetBingoOverviewResponse,
  ListBingoCardsResponse,
  ListBingoGamesResponse,
  GetBingoGameResponse,
  CreateBingoGameResponse,
  AdvanceBingoGameResponse,
  GetBingoWalletResponse,
  SubmitBingoWalletActionResponse,
  GetBingoAdminResponse,
} from "@workspace/api-zod";
import {
  advanceGame,
  createGame,
  getActivities,
  getCards,
  getGame,
  getGames,
  getWallet,
  walletAction,
} from "../lib/bingo-store";

const router: IRouter = Router();

router.get("/bingo/overview", (_req, res): void => {
  const games = getGames();
  const wallet = getWallet();
  const latestGame = games[0];
  const response = {
    activeGames: games.filter((game) => game.status === "live").length,
    playersOnline: games.reduce((total, game) => total + game.players.length, 0),
    cardsAvailable: getCards().filter((card) => card.status === "available").length,
    demoBalance: wallet.balance,
    latestGame,
    recentActivity: getActivities(),
  };
  res.json(GetBingoOverviewResponse.parse(response));
});

router.get("/bingo/cards", (_req, res): void => {
  res.json(ListBingoCardsResponse.parse(getCards()));
});

router.get("/bingo/games", (_req, res): void => {
  res.json(ListBingoGamesResponse.parse(getGames()));
});

router.post("/bingo/games", (req, res): void => {
  const parsed = CreateBingoGameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.status(201).json(CreateBingoGameResponse.parse(createGame(parsed.data.name, parsed.data.category)));
});

router.get("/bingo/games/:gameId", (req, res): void => {
  const params = GetBingoGameParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const game = getGame(params.data.gameId);
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.json(GetBingoGameResponse.parse(game));
});

router.post("/bingo/games/:gameId", (req, res): void => {
  const params = AdvanceBingoGameParams.safeParse(req.params);
  const body = AdvanceBingoGameBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const game = advanceGame(params.data.gameId, body.data.action);
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.json(AdvanceBingoGameResponse.parse(game));
});

router.get("/bingo/wallet", (_req, res): void => {
  res.json(GetBingoWalletResponse.parse(getWallet()));
});

router.post("/bingo/wallet", (req, res): void => {
  const parsed = SubmitBingoWalletActionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    res.json(
      SubmitBingoWalletActionResponse.parse(
        walletAction(parsed.data.type, parsed.data.amount, parsed.data.method),
      ),
    );
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Wallet action failed" });
  }
});

router.get("/bingo/admin", (_req, res): void => {
  const games = getGames();
  const players = games.reduce((total, game) => total + game.players.length, 0);
  const categories = ["normal", "vip", "vvip"] as const;
  const topCategories = categories.map((category) => {
    const count = games.reduce(
      (total, game) => total + game.players.filter((player) => player.category === category).length,
      0,
    );
    return { category, players: count, share: players ? Math.round((count / players) * 100) : 0 };
  });
  res.json(
    GetBingoAdminResponse.parse({
      totalUsers: 128,
      activeGames: games.filter((game) => game.status === "live").length,
      cardsInUse: getCards().filter((card) => card.status === "in-play").length,
      demoVolume: 18450,
      topCategories,
      activity: getActivities(),
    }),
  );
});

export default router;