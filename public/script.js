const socket = io();

// DOM要素
const screens = {
    login: document.getElementById('login-screen'),
    game: document.getElementById('game-screen')
};
const elements = {
    roomInput: document.getElementById('room-input'),
    joinBtn: document.getElementById('join-btn'),
    roomIdDisplay: document.getElementById('room-id-display'),
    statusMessage: document.getElementById('status-message'),
    board: document.getElementById('board'),
    players: [
        { card: document.getElementById('p1-card'), score: document.getElementById('p1-score') },
        { card: document.getElementById('p2-card'), score: document.getElementById('p2-score') }
    ],
    roleDisplay: document.getElementById('role-display'),
    modal: document.getElementById('result-modal'),
    winnerText: document.getElementById('winner-text')
};

// 状態変数
let myPlayerIndex = -1; // 0 or 1, -1 if spectator
let currentRoomId = null;
let isMyTurn = false;

// ユーザーID生成（再接続用）
// sessionStorageに保存することで、タブごとに別ユーザー扱いにする
// (リロード時は保持されるが、別タブで開くと新規ユーザーになる)
let userId = sessionStorage.getItem('memory_game_userid');
if (!userId) {
    userId = 'user_' + Math.random().toString(36).substr(2, 9);
    sessionStorage.setItem('memory_game_userid', userId);
}

// --- イベントリスナー ---

elements.joinBtn.addEventListener('click', () => {
    const roomId = elements.roomInput.value.trim();
    if (!roomId) {
        alert('ルームIDを入力してください');
        return;
    }
    currentRoomId = roomId;
    socket.emit('join_room', { roomId, userId });
});

elements.leaveBtn = document.getElementById('leave-btn');
elements.leaveBtn.addEventListener('click', () => {
    if (confirm('ルームから退出しますか？')) {
        socket.emit('leave_room', { roomId: currentRoomId });
        backToHome();
    }
});

function backToHome() {
    screens.game.classList.add('hidden');
    screens.login.classList.remove('hidden');
    currentRoomId = null;
    elements.board.innerHTML = '';
    elements.statusMessage.textContent = '';
    isMyTurn = false;
}

// カードクリック処理
function handleCardClick(index) {
    if (!isMyTurn) return;
    socket.emit('flip_card', { roomId: currentRoomId, cardIndex: index });
}

// --- Socket受信イベント ---

// ルーム入室完了
socket.on('room_joined', (data) => {
    // 画面切り替え
    screens.login.classList.add('hidden');
    screens.game.classList.remove('hidden');

    elements.roomIdDisplay.textContent = data.roomId;
    myPlayerIndex = data.playerIndex;

    // 役割表示
    if (data.role === 'spectator') {
        elements.roleDisplay.textContent = '観戦モード';
        elements.statusMessage.textContent = '観戦中...';
        elements.board.style.pointerEvents = 'none'; // 操作不可
    } else {
        elements.roleDisplay.textContent = `あなたは Player ${myPlayerIndex + 1}`;
    }

    // 盤面描画
    renderBoard(data.board);

    // スコア更新
    updateScores(data.players);

    // ターン表示更新
    updateTurn(data.turnIndex);

    // ゲーム状態によるメッセージ更新
    if (data.gameState === 'waiting') {
        elements.statusMessage.textContent = '対戦相手を待っています...';
    }
});

// ゲーム開始
socket.on('game_start', (data) => {
    elements.statusMessage.textContent = 'ゲーム開始！';
    renderBoard(data.board);
    updateTurn(data.turnIndex);
});

// カードがめくられた
socket.on('card_flipped', (data) => {
    const cardEl = document.getElementById(`card-${data.cardIndex}`);
    if (cardEl) {
        flipCardVisual(cardEl, data.value);
    }
});

// ターン交代 (不正解時の裏返し処理含む)
socket.on('turn_change', (data) => {
    // 裏返す処理
    if (data.resetCards) {
        data.resetCards.forEach(index => {
            const cardEl = document.getElementById(`card-${index}`);
            if (cardEl) {
                unflipCardVisual(cardEl);
            }
        });
    }
    updateTurn(data.turnIndex);
});

// マッチ判定結果（正解時の処理）
socket.on('match_result', (data) => {
    if (data.success) {
        data.matchedCards.forEach(index => {
            const cardEl = document.getElementById(`card-${index}`);
            if (cardEl) cardEl.classList.add('matched');
        });

        // スコア更新
        elements.players[0].score.textContent = data.scores[0];
        elements.players[1].score.textContent = data.scores[1];
    }
});

// プレイヤー入室通知
socket.on('player_joined', () => {
    // プレイヤーが揃ったことはgame_startなどでわかるので、ここではログ程度でもOK
    // 必要ならUI更新
});

// 相手の切断/再接続
socket.on('player_disconnected', (data) => {
    elements.statusMessage.textContent = `Player ${data.playerIndex + 1} が切断しました...`;
    elements.players[data.playerIndex].card.style.opacity = '0.5';
});

socket.on('player_reconnected', (data) => {
    elements.statusMessage.textContent = `Player ${data.playerIndex + 1} が復帰しました！`;
    elements.players[data.playerIndex].card.style.opacity = '1';
});

// ゲーム終了
// ゲーム終了
socket.on('game_over', (data) => {
    elements.modal.classList.remove('hidden');
    elements.winnerText.textContent =
        data.winner === 'draw' ? '引き分け！' : `勝者: ${data.winner}`;
});

// ゲームリセット（再戦）
socket.on('game_reset', (data) => {
    elements.modal.classList.add('hidden');
    elements.statusMessage.textContent = 'ゲーム再開！';

    // 盤面とスコアの初期化
    renderBoard(data.board);
    updateTurn(data.turnIndex);

    // スコア表示リセット
    elements.players.forEach((p, i) => {
        p.score.textContent = 0;
    });
});

// --- 結果画面のボタン処理 ---
// ボタンが存在するか確認してからイベントリスナーを追加（エラー防止）
if (document.getElementById('rematch-btn')) {
    document.getElementById('rematch-btn').addEventListener('click', () => {
        socket.emit('request_rematch', { roomId: currentRoomId });
    });
}

if (document.getElementById('home-btn')) {
    document.getElementById('home-btn').addEventListener('click', () => {
        socket.emit('leave_room', { roomId: currentRoomId });
        elements.modal.classList.add('hidden');
        backToHome();
    });
}


// --- 描画・UI更新関数 ---

function renderBoard(boardData) {
    elements.board.innerHTML = '';
    boardData.forEach((card, index) => {
        const div = document.createElement('div');
        div.className = 'card';
        div.id = `card-${index}`;

        // 状態の適用
        if (card.state === 'flipped' || card.state === 'matched') {
            div.classList.add('flipped');
            if (card.state === 'matched') div.classList.add('matched');
            div.innerHTML = `<span>${card.value}</span>`;
        } else {
            div.innerHTML = `<span></span>`; // 中身は隠す
        }

        // クリックイベント
        div.onclick = () => handleCardClick(index);
        elements.board.appendChild(div);
    });
}

function flipCardVisual(el, value) {
    el.classList.add('flipped');
    el.innerHTML = `<span>${value}</span>`;
}

function unflipCardVisual(el) {
    el.classList.remove('flipped');
    el.innerHTML = `<span></span>`;
}

function updateTurn(turnIndex) {
    // プレイヤー強調表示
    elements.players.forEach((p, i) => {
        if (i === turnIndex) p.card.classList.add('active');
        else p.card.classList.remove('active');
    });

    // メッセージ更新
    if (myPlayerIndex === -1) {
        // 観戦者
        elements.statusMessage.textContent = `Player ${turnIndex + 1} のターン`;
        isMyTurn = false;
    } else if (myPlayerIndex === turnIndex) {
        elements.statusMessage.textContent = 'あなたのターンです！';
        isMyTurn = true;
    } else {
        elements.statusMessage.textContent = '相手のターンです';
        isMyTurn = false;
    }
}

function updateScores(playersData) {
    playersData.forEach((p, i) => {
        if (elements.players[i]) {
            elements.players[i].score.textContent = p.score;
        }
    });
}
