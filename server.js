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

// カードの絵柄（8ペア）
const EMOJIS = ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼'];

// シャッフル関数
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// 新しいゲームボードを作成
function createBoard() {
    const cards = [];
    // 8種類の絵柄を2枚ずつ追加
    [...EMOJIS, ...EMOJIS].forEach((emoji, index) => {
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

    // ルームに参加
    socket.on('join_room', ({ roomId, userId }) => {
        if (!rooms[roomId]) {
            // ルームが存在しない場合、新規作成
            rooms[roomId] = {
                players: [],
                spectators: [],
                board: createBoard(),
                turnIndex: 0,
                flippedCards: [],
                gameState: 'waiting',
                timer: null
            };
        }

        const room = rooms[roomId];
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

            // 相手に再接続を通知
            socket.to(roomId).emit('player_reconnected', { playerIndex });

        } else if (room.players.length < 2) {
            // 新規プレイヤー参加
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
            // 観戦者として参加
            room.spectators.push(socket.id);
        }

        socket.join(roomId);

        // 参加者への現在のルーム状態通知
        socket.emit('room_joined', {
            roomId,
            role,
            playerIndex,
            gameState: room.gameState,
            board: room.board,
            players: room.players.map(p => ({ score: p.score, name: p.name, connected: p.connected })),
            turnIndex: room.turnIndex
        });

        // 対戦相手が揃ったらゲーム開始
        if (room.gameState === 'waiting' && room.players.length === 2) {
            room.gameState = 'playing';
            io.to(roomId).emit('game_start', {
                board: room.board,
                turnIndex: room.turnIndex
            });
        }
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
                    scores: room.players.map(p => p.score)
                });

                // ゲーム終了判定
                const isGameOver = room.board.every(c => c.state === 'matched');
                if (isGameOver) {
                    room.gameState = 'finished';
                    // 勝者判定
                    let winner = 'draw';
                    if (room.players[0].score > room.players[1].score) winner = 'Player 1';
                    else if (room.players[1].score > room.players[0].score) winner = 'Player 2';

                    io.to(roomId).emit('game_over', {
                        winner,
                        scores: room.players.map(p => p.score)
                    });
                }
                // ペア成立時はターン交代しない（もう一度プレイ）

            } else {
                // 不正解

                // 少し待ってから裏返す処理
                // タイマーを設定して、他の操作をブロックする意図もあるが、
                // 今回はシンプルにクライアント側でもアニメーション時間を考慮させる。
                // サーバー側で一定時間後に「裏返し＆ターン交代」イベントを送る。

                // タイムアウト待ち中に他の操作を受け付けないようにするには？
                // flippedCardsが残っている間は次のflipを受け付けないガードが入っているのでOK。

                room.timer = setTimeout(() => {
                    // カードを裏返す
                    room.board[first.index].state = 'hidden';
                    room.board[second.index].state = 'hidden';
                    room.flippedCards = [];

                    // ターン交代
                    room.turnIndex = (room.turnIndex + 1) % 2;

                    io.to(roomId).emit('turn_change', {
                        turnIndex: room.turnIndex,
                        resetCards: [first.index, second.index] // 裏返すカード
                    });

                    room.timer = null;
                }, 1000); // 1秒後に裏返す
            }
        }
    });



    // 再戦要求（リセット）
    socket.on('request_rematch', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room) return;

        // ゲーム状態をリセット
        room.board = createBoard();
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
            players: room.players.map(p => ({ score: 0 }))
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
            io.to(roomId).emit('player_disconnected', {
                playerIndex: room.players.indexOf(player)
            });
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
        // 所属していたルームを探す
        // roomsはroomIdキーのオブジェクトなのでループで探す（効率は良くないが今回は小規模なのでOK）
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const player = room.players.find(p => p.id === socket.id);

            if (player) {
                console.log(`Player disconnected from room ${roomId}`);
                player.connected = false; // 切断状態にするが削除はしない
                io.to(roomId).emit('player_disconnected', {
                    playerIndex: room.players.indexOf(player)
                });

                // もし両方とも長期間いない場合などのクリーンアップ処理は今回は省略
            } else {
                // 観戦者の削除
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
