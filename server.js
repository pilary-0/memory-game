const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// 静的ファイルの配信
app.use(express.static(path.join(__dirname, 'public')));

// ルーム情報を管理するオブジェクト
// 構造:
// {
//   [roomId]: {
//     players: [ { id: 'socketId', userId: 'uuid', score: 0, connected: true, name: 'Guest' } ],
//     spectators: [ 'socketId' ],
//     board: [ { id: 0, value: '🍎', state: 'hidden' } ],
//     turnIndex: 0, // 0 または 1
//     flippedCards: [ { index: 0, value: '🍎' } ],
//     gameState: 'waiting', // 'waiting' | 'playing' | 'finished'
//     timer: null
//   }
// }
const rooms = {};

// 動物の絵文字リスト（20種類）
const EMOJIS = [
    '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯',
    '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🦆'
];

// プレイヤー人数に応じたペア数を決定
function getPairCount(playerCount) {
    if (playerCount === 2) return 8;  // 16枚
    if (playerCount === 3) return 12; // 24枚
    if (playerCount === 4) return 16; // 32枚
    if (playerCount === 5) return 20; // 40枚
    return 8; // デフォルト
}

// シャッフル関数
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// 新しいゲームボードを作成
function createBoard(pairCount) {
    const cards = [];
    const selectedEmojis = EMOJIS.slice(0, pairCount);

    // 選ばれた絵文字を2枚ずつ追加
    [...selectedEmojis, ...selectedEmojis].forEach((emoji, index) => {
        cards.push({
            id: index,
            value: emoji,
            state: 'hidden' // hidden, flipped, matched
        });
    });
    return shuffle(cards);
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // ルームを作成（ホストのみ）
    socket.on('create_room', ({ roomId }) => {
        if (rooms[roomId]) {
            socket.emit('error_message', { message: 'そのルームIDは既に使用されています' });
            return;
        }

        rooms[roomId] = {
            players: [],
            spectators: [],
            board: [], // ゲーム開始時に生成
            turnIndex: 0,
            flippedCards: [],
            gameState: 'waiting',
            timer: null,
            hostId: socket.id // ホストのSocketIDを記録
        };
        console.log(`Room created: ${roomId}`);
        socket.emit('room_created', { roomId });
    });

    // ルームに参加
    socket.on('join_room', ({ roomId, userId }) => {
        const room = rooms[roomId];
        if (!room) {
            socket.emit('error_message', { message: 'ルームが見つかりません。IDを確認してください。' });
            return;
        }

        let role = 'spectator';
        let playerIndex = -1;

        // プレイヤーとして再接続できるかチェック
        const existingPlayerIndex = room.players.findIndex(p => p.userId === userId);

        if (existingPlayerIndex !== -1) {
            // 再接続処理
            console.log(`Player reconnected: ${userId} to room ${roomId}`);
            room.players[existingPlayerIndex].id = socket.id; // 新しいSocketIDに更新
            room.players[existingPlayerIndex].connected = true;
            role = 'player';
            playerIndex = existingPlayerIndex;

            // もしホストが切断して再接続した場合、ホスト権限を戻すか？
            // 簡易的に、最初のプレイヤー(index 0)をホストとみなすロジックにするなら特に処理不要

            socket.to(roomId).emit('player_reconnected', { playerIndex });

        } else if (room.gameState === 'waiting' && room.players.length < 5) {
            // 新規プレイヤー参加 (待機中かつ5人未満)
            role = 'player';
            playerIndex = room.players.length;
            room.players.push({
                id: socket.id,
                userId: userId,
                score: 0,
                connected: true,
                name: `Player ${playerIndex + 1}`
            });
        } else {
            // 観戦者として参加（満員またはゲーム中）
            room.spectators.push(socket.id);
        }

        socket.join(roomId);

        // 参加者への現在のルーム状態通知
        // ホストかどうかを判定 (Player 1 がホスト)
        const isHost = (playerIndex === 0);

        socket.emit('room_joined', {
            roomId,
            role,
            playerIndex,
            gameState: room.gameState,
            board: room.board,
            players: room.players.map(p => ({ score: p.score, name: p.name, connected: p.connected })),
            turnIndex: room.turnIndex,
            isHost: isHost
        });

        // 全員に参加者を通知（人数更新のため）
        io.to(roomId).emit('player_update', {
            players: room.players.map(p => ({ score: p.score, name: p.name, connected: p.connected }))
        });
    });

    // ゲーム開始要求（ホストのみ）
    socket.on('start_game', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room) return;

        // ホスト（Player 0）からの要求か確認
        // 簡易的に players[0].id と一致するかで判定
        if (room.players.length === 0 || room.players[0].id !== socket.id) {
            return;
        }

        if (room.players.length < 2) {
            socket.emit('error_message', { message: '対戦相手がいません' });
            return;
        }

        // ゲーム初期化
        const pairCount = getPairCount(room.players.length);
        room.board = createBoard(pairCount);
        room.gameState = 'playing';
        room.turnIndex = 0;
        room.flippedCards = [];
        room.players.forEach(p => p.score = 0); // スコアリセット

        io.to(roomId).emit('game_start', {
            board: room.board,
            turnIndex: room.turnIndex,
            players: room.players.map(p => ({ score: 0, name: p.name, connected: p.connected }))
        });
    });

    // カードをめくる
    socket.on('flip_card', ({ roomId, cardIndex }) => {
        const room = rooms[roomId];

        // バリデーション
        if (!room || room.gameState !== 'playing') return;

        // 現在のターンプレイヤーか確認
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return; // 観戦者などは無視

        const playerIdx = room.players.indexOf(player);
        if (playerIdx !== room.turnIndex) return; // 自分のターンでない

        // カードが既にめくられている、またはペア済みなら無視
        const card = room.board[cardIndex];
        if (card.state !== 'hidden') return;

        // 同一ターンで3枚以上めくろうとしていないか（念のため）
        if (room.flippedCards.length >= 2) return;

        // カード状態更新
        card.state = 'flipped';
        room.flippedCards.push({ index: cardIndex, value: card.value });

        // 全員に通知
        io.to(roomId).emit('card_flipped', {
            cardIndex,
            value: card.value
        });

        // 2枚めくった場合の判定
        if (room.flippedCards.length === 2) {
            const [first, second] = room.flippedCards;

            if (first.value === second.value) {
                // 正解（ペア成立）
                room.board[first.index].state = 'matched';
                room.board[second.index].state = 'matched';
                player.score += 1;

                // カードリストリセット
                room.flippedCards = [];

                // 結果通知
                io.to(roomId).emit('match_result', {
                    success: true,
                    matchedCards: [first.index, second.index],
                    scores: room.players.map(p => p.score),
                    turnIndex: room.turnIndex // ターンは変わらない
                });

                // ゲーム終了判定
                const isGameOver = room.board.every(c => c.state === 'matched');
                if (isGameOver) {
                    room.gameState = 'finished';
                    // 勝者判定（最高得点者、複数可）
                    const maxScore = Math.max(...room.players.map(p => p.score));
                    const winners = room.players
                        .filter(p => p.score === maxScore)
                        .map(p => p.name);

                    let winnerText = winners.join(', ');
                    if (winners.length > 1) winnerText += ' (引き分け)';

                    io.to(roomId).emit('game_over', {
                        winner: winnerText,
                        scores: room.players.map(p => p.score)
                    });
                }
                // ペア成立時はターン交代しない（もう一度プレイ）

            } else {
                // 不正解
                room.timer = setTimeout(() => {
                    // カードを裏返す
                    room.board[first.index].state = 'hidden';
                    room.board[second.index].state = 'hidden';
                    room.flippedCards = [];

                    // ターン交代 (次の人へ、人数で割った余り)
                    const nextTurnIndex = (room.turnIndex + 1) % room.players.length;

                    // 次のプレイヤーが接続断の場合はさらに次へ飛ばす処理（簡易実装）
                    // 厳密にはwhileループでconnectedなプレイヤーを探すべきだが、今回はシンプルに
                    // 誰もいなければ何もしない等は考慮が必要だが、再接続も考慮してそのまま回す

                    room.turnIndex = nextTurnIndex;

                    io.to(roomId).emit('turn_change', {
                        turnIndex: room.turnIndex,
                        resetCards: [first.index, second.index] // 裏返すカード
                    });

                    room.timer = null;
                }, 1000); // 1秒後に裏返す
            }
        }
    });

    // 再戦要求（リセット） - ホストのみ可能にするか？今回は誰でも押せる仕様のまま、ただし全員合意ではなく即時リセット
    socket.on('request_rematch', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room) return;

        // ホストのみ再戦可能にするならここでチェックを入れる

        // 新しいボードを作成（人数は現在のプレイヤー数で）
        // プレイヤーが減っている可能性もあるのでフィルタリングするか？
        // ここでは単純に現在の room.players.length を使う
        const pairCount = getPairCount(room.players.length);
        room.board = createBoard(pairCount);

        room.flippedCards = [];
        room.turnIndex = 0; // Player 1 から開始
        room.gameState = 'playing';
        room.timer = null;

        // スコアリセット
        room.players.forEach(p => p.score = 0);

        // 全員に通知してゲーム再開
        io.to(roomId).emit('game_reset', {
            board: room.board,
            turnIndex: room.turnIndex,
            players: room.players.map(p => ({ score: 0, name: p.name, connected: p.connected }))
        });
    });

    // 退出処理 (明示的な退出)
    socket.on('leave_room', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room) return;

        console.log(`User left room ${roomId}: ${socket.id}`);
        socket.leave(roomId);

        // プレイヤーの場合
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            player.connected = false;
            // プレイヤーリストから削除はしない（再入室のID管理が複雑になるため、切断扱いにする）
            // ただし、ゲーム開始前なら削除しても良いかもしれない。
            // 今回は「切断」扱い統一でシンプルに。

            // ゲーム開始前なら配列から消す？ -> 5人枠を空けるため必要。
            if (room.gameState === 'waiting') {
                const idx = room.players.indexOf(player);
                room.players.splice(idx, 1);
                // 名前を振り直す（Player 1, 2...）
                room.players.forEach((p, i) => p.name = `Player ${i + 1}`);

                // 更新通知
                io.to(roomId).emit('player_update', {
                    players: room.players.map(p => ({ score: p.score, name: p.name, connected: p.connected }))
                });
            } else {
                io.to(roomId).emit('player_disconnected', {
                    playerIndex: room.players.indexOf(player)
                });
            }
        }
        // 観戦者の場合
        else {
            const spectatorIndex = room.spectators.indexOf(socket.id);
            if (spectatorIndex !== -1) {
                room.spectators.splice(spectatorIndex, 1);
            }
        }
    });

    // 切断処理
    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const player = room.players.find(p => p.id === socket.id);

            if (player) {
                console.log(`Player disconnected from room ${roomId}`);
                player.connected = false;

                if (room.gameState === 'waiting') {
                    // 待機中なら削除
                    const idx = room.players.indexOf(player);
                    room.players.splice(idx, 1);
                    room.players.forEach((p, i) => p.name = `Player ${i + 1}`);

                    io.to(roomId).emit('player_update', {
                        players: room.players.map(p => ({ score: p.score, name: p.name, connected: p.connected }))
                    });
                } else {
                    // ゲーム中なら切断状態通知
                    io.to(roomId).emit('player_disconnected', {
                        playerIndex: room.players.indexOf(player)
                    });
                }
            } else {
                const spectatorIndex = room.spectators.indexOf(socket.id);
                if (spectatorIndex !== -1) {
                    room.spectators.splice(spectatorIndex, 1);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
