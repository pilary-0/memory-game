const socket = io();

// DOM要素
const screens = {
    login: document.getElementById('login-screen'),
    game: document.getElementById('game-screen')
};
const elements = {
    roomInput: document.getElementById('room-input'),
    roomIdDisplay: document.getElementById('room-id-display'),
    statusMessage: document.getElementById('status-message'),
    board: document.getElementById('board'),
    scoreboard: document.getElementById('scoreboard'),
    players: [], // 動的に管理
    roleDisplay: document.getElementById('role-display'),
    modal: document.getElementById('result-modal'),
    winnerText: document.getElementById('winner-text'),
    startGameBtn: document.getElementById('start-game-btn'),
    playerListLobby: document.getElementById('player-list-lobby'),
    playerCountLobby: document.getElementById('player-count')
};

// 状態変数
let myPlayerIndex = -1; // 0 or 1... -1 if spectator
let currentRoomId = null;
let isMyTurn = false;
let isHost = false;

// ユーザーID生成（再接続用）
let userId = sessionStorage.getItem('memory_game_userid');
if (!userId) {
    userId = 'user_' + Math.random().toString(36).substr(2, 9);
    sessionStorage.setItem('memory_game_userid', userId);
}

// --- イベントリスナー ---

// 「ルームを作る」ボタン
document.getElementById('mode-create').addEventListener('click', () => {
    const newRoomId = Math.floor(100000 + Math.random() * 900000).toString();
    currentRoomId = newRoomId;
    socket.emit('create_room', { roomId: newRoomId });
});

// ルーム作成成功時の処理
socket.on('room_created', (data) => {
    currentRoomId = data.roomId;
    document.querySelector('.menu-actions').classList.add('hidden');
    document.getElementById('create-view').classList.remove('hidden');
    document.getElementById('generated-room-id').textContent = data.roomId;

    socket.emit('join_room', { roomId: data.roomId, userId });
});

// エラー受取
socket.on('error_message', (data) => {
    alert(data.message);
    if (data.message.includes('見つかりません')) {
        backToHome();
    }
});

// 「ルームに参加する」ボタン
document.getElementById('mode-join').addEventListener('click', () => {
    document.querySelector('.menu-actions').classList.add('hidden');
    document.getElementById('join-view').classList.remove('hidden');
});

// 「参加する（確定）」ボタン
document.getElementById('join-confirm-btn').addEventListener('click', joinRoom);

function joinRoom() {
    const roomId = elements.roomInput.value.trim();
    if (!roomId) {
        alert('ルームIDを入力してください');
        return;
    }
    currentRoomId = roomId;
    socket.emit('join_room', { roomId, userId });
}

// ゲーム開始ボタン（ホストのみ）
elements.startGameBtn.addEventListener('click', () => {
    if (currentRoomId) {
        socket.emit('start_game', { roomId: currentRoomId });
    }
});

// IDコピーボタン
document.getElementById('copy-btn').addEventListener('click', () => {
    const text = document.getElementById('generated-room-id').textContent;
    navigator.clipboard.writeText(text).then(() => {
        alert('IDをコピーしました: ' + text);
    });
});

// 「戻る」ボタン
document.querySelectorAll('.back-link').forEach(btn => {
    btn.addEventListener('click', () => {
        if (currentRoomId) {
            socket.emit('leave_room', { roomId: currentRoomId });
            currentRoomId = null;
        }
        document.getElementById('create-view').classList.add('hidden');
        document.getElementById('join-view').classList.add('hidden');
        document.querySelector('.menu-actions').classList.remove('hidden');
        elements.roomInput.value = '';
    });
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

    document.getElementById('create-view').classList.add('hidden');
    document.getElementById('join-view').classList.add('hidden');
    document.querySelector('.menu-actions').classList.remove('hidden');

    currentRoomId = null;
    elements.board.innerHTML = '';
    elements.statusMessage.textContent = '';
    elements.roomInput.value = '';
    elements.startGameBtn.classList.add('hidden');
    isMyTurn = false;
    isHost = false;
}

// カードクリック処理
function handleCardClick(index) {
    if (!isMyTurn) return;
    socket.emit('flip_card', { roomId: currentRoomId, cardIndex: index });
}

// --- Socket受信イベント ---

// ルーム入室完了
socket.on('room_joined', (data) => {
    elements.roomIdDisplay.textContent = data.roomId;
    myPlayerIndex = data.playerIndex;
    isHost = data.isHost;

    if (data.gameState === 'waiting') {
        elements.statusMessage.textContent = '対戦相手を待っています...';

        // プレイヤーとして待機画面にいる場合
        if (isHost) {
            elements.startGameBtn.classList.remove('hidden');
        } else {
            elements.startGameBtn.classList.add('hidden');
        }

        // 待機画面の更新
        renderLobbyPlayerList(data.players);

        return;
    }

    // 途中参加（観戦）または再接続でゲーム中
    screens.login.classList.add('hidden');
    screens.game.classList.remove('hidden');

    if (data.role === 'spectator') {
        elements.roleDisplay.textContent = '観戦モード';
        elements.statusMessage.textContent = '観戦中...';
        elements.board.style.pointerEvents = 'none';
    } else {
        if (data.players[myPlayerIndex]) {
            elements.roleDisplay.textContent = `あなたは ${data.players[myPlayerIndex].name}`;
        }
    }

    // スコアボード構築 & 盤面描画
    renderScoreboard(data.players);
    renderBoard(data.board);
    updateScores(data.players);
    updateTurn(data.turnIndex);
});

// プレイヤー情報更新（ロビー待機中）
socket.on('player_update', (data) => {
    renderLobbyPlayerList(data.players);
});

function renderLobbyPlayerList(players) {
    elements.playerCountLobby.textContent = `参加者: ${players.length}人`;
    elements.playerListLobby.innerHTML = '';
    players.forEach(p => {
        const li = document.createElement('li');
        li.textContent = p.name + (p.connected ? '' : ' (切断)');
        elements.playerListLobby.appendChild(li);
    });

    // 開始ボタンの有効化（2人以上）
    if (players.length >= 2) {
        elements.startGameBtn.disabled = false;
    } else {
        elements.startGameBtn.disabled = true;
    }
}


// ゲーム開始
socket.on('game_start', (data) => {
    screens.login.classList.add('hidden');
    screens.game.classList.remove('hidden');

    // 自分自身の表示名更新（Player X）
    if (myPlayerIndex !== -1 && data.players[myPlayerIndex]) {
        elements.roleDisplay.textContent = `あなたは ${data.players[myPlayerIndex].name}`;
    }

    elements.statusMessage.textContent = 'ゲーム開始！';

    renderScoreboard(data.players);
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

// ターン交代
socket.on('turn_change', (data) => {
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

// マッチ判定結果
socket.on('match_result', (data) => {
    if (data.success) {
        data.matchedCards.forEach(index => {
            const cardEl = document.getElementById(`card-${index}`);
            if (cardEl) cardEl.classList.add('matched');
        });

        // スコア更新
        updateScoresWithoutRender(data.scores); // 数値だけ更新

        if (window.confetti) window.confetti.trigger();
    }
});

// プレイヤー切断
socket.on('player_disconnected', (data) => {
    if (elements.players[data.playerIndex]) {
        elements.statusMessage.textContent = `${elements.players[data.playerIndex].nameElem.textContent} が切断しました...`;
        elements.players[data.playerIndex].card.style.opacity = '0.5';
    }
});

// プレイヤー再接続
socket.on('player_reconnected', (data) => {
    if (elements.players[data.playerIndex]) {
        elements.statusMessage.textContent = `${elements.players[data.playerIndex].nameElem.textContent} が復帰しました！`;
        elements.players[data.playerIndex].card.style.opacity = '1';
    }
});

// ゲーム終了
socket.on('game_over', (data) => {
    elements.modal.classList.remove('hidden');
    elements.winnerText.textContent =
        data.winner.includes('引き分け') ? data.winner : `勝者: ${data.winner}`;

    if (window.confetti) window.confetti.trigger();
});

// ゲームリセット
socket.on('game_reset', (data) => {
    elements.modal.classList.add('hidden');
    elements.statusMessage.textContent = 'ゲーム再開！';

    renderScoreboard(data.players);
    renderBoard(data.board);
    updateTurn(data.turnIndex);
});

// --- 結果画面のボタン処理 ---
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

function renderScoreboard(playersData) {
    elements.scoreboard.innerHTML = '';
    elements.players = [];

    playersData.forEach((p, index) => {
        const cardDiv = document.createElement('div');
        cardDiv.className = 'player-card';
        cardDiv.id = `p${index}-card`;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'name';
        nameSpan.textContent = p.name;

        const scoreSpan = document.createElement('span');
        scoreSpan.className = 'score';
        scoreSpan.id = `p${index}-score`;
        scoreSpan.textContent = p.score;

        const indicator = document.createElement('span');
        indicator.className = 'indicator';

        cardDiv.appendChild(nameSpan);
        cardDiv.appendChild(scoreSpan);
        cardDiv.appendChild(indicator);

        elements.scoreboard.appendChild(cardDiv);

        // 参照を保存
        elements.players.push({
            card: cardDiv,
            score: scoreSpan,
            nameElem: nameSpan
        });
    });
}

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
            // 絵文字をspanで囲む
            div.innerHTML = `<span>${card.value}</span>`;
        } else {
            div.innerHTML = ''; // 中身は隠す
        }

        // クリックイベント
        div.onclick = () => handleCardClick(index);
        elements.board.appendChild(div);
    });
}

function flipCardVisual(el, value) {
    el.classList.add('flipped');
    // 絵文字をspanで囲む
    el.innerHTML = `<span>${value}</span>`;
}

function unflipCardVisual(el) {
    el.classList.remove('flipped');
    el.innerHTML = '';
}

function updateTurn(turnIndex) {
    // プレイヤー強調表示
    elements.players.forEach((p, i) => {
        if (!p) return;
        if (i === turnIndex) p.card.classList.add('active');
        else p.card.classList.remove('active');
    });

    // メッセージ更新
    if (myPlayerIndex === -1) {
        elements.statusMessage.textContent = `Player ${turnIndex + 1} のターン`;
        isMyTurn = false;
    } else if (myPlayerIndex === turnIndex) {
        elements.statusMessage.textContent = 'あなたのターンです！';
        isMyTurn = true;
    } else {
        const currentPlayerName = elements.players[turnIndex] ? elements.players[turnIndex].nameElem.textContent : `Player ${turnIndex + 1}`;
        elements.statusMessage.textContent = `${currentPlayerName} のターンです`;
        isMyTurn = false;
    }
}

function updateScores(playersData) {
    renderScoreboard(playersData); // 全再描画（シンプル）
}

function updateScoresWithoutRender(scores) {
    scores.forEach((score, i) => {
        if (elements.players[i]) {
            elements.players[i].score.textContent = score;
        }
    });
}
