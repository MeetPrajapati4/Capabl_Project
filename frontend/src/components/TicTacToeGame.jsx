import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { WifiOff, Wifi, RefreshCw, X, RotateCcw, Trophy, User, Bot } from './Icons';

const WINNING_COMBOS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
  [0, 4, 8], [2, 4, 6]             // diagonals
];

function checkWinner(board) {
  for (const combo of WINNING_COMBOS) {
    const [a, b, c] = combo;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], combo };
    }
  }
  if (board.every(cell => cell !== null)) {
    return { winner: 'draw', combo: [] };
  }
  return null;
}

// Simple smart AI move picker
function getBestMove(board, aiSymbol, humanSymbol) {
  // 1. Can AI win immediately?
  for (let i = 0; i < 9; i++) {
    if (!board[i]) {
      board[i] = aiSymbol;
      const res = checkWinner(board);
      board[i] = null;
      if (res && res.winner === aiSymbol) return i;
    }
  }

  // 2. Must AI block human?
  for (let i = 0; i < 9; i++) {
    if (!board[i]) {
      board[i] = humanSymbol;
      const res = checkWinner(board);
      board[i] = null;
      if (res && res.winner === humanSymbol) return i;
    }
  }

  // 3. Take center if available
  if (!board[4]) return 4;

  // 4. Take available corners
  const corners = [0, 2, 6, 8].filter(idx => !board[idx]);
  if (corners.length > 0) {
    return corners[Math.floor(Math.random() * corners.length)];
  }

  // 5. Take any remaining empty cell
  const empty = board.map((c, i) => c === null ? i : null).filter(i => i !== null);
  return empty[Math.floor(Math.random() * empty.length)];
}

export default function TicTacToeGame({ isOpen, onClose, onRetry, queryToRetry }) {
  const [board, setBoard] = useState(Array(9).fill(null));
  const [isXNext, setIsXNext] = useState(true);
  const [gameMode, setGameMode] = useState('ai'); // 'ai' or 'pvp'
  const [humanSymbol, setHumanSymbol] = useState('X');
  const [scores, setScores] = useState({ human: 0, ai: 0, draws: 0 });
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  const aiSymbol = humanSymbol === 'X' ? 'O' : 'X';
  const gameResult = checkWinner(board);
  const isHumanTurn = gameMode === 'pvp' || (humanSymbol === 'X' ? isXNext : !isXNext);

  // Monitor network connectivity in real-time
  useEffect(() => {
    function handleOnline() { setIsOnline(true); }
    function handleOffline() { setIsOnline(false); }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // AI move trigger
  useEffect(() => {
    if (!isOpen || gameMode !== 'ai' || gameResult) return;

    if (!isHumanTurn) {
      const timer = setTimeout(() => {
        const move = getBestMove(board, aiSymbol, humanSymbol);
        if (move !== undefined && move !== null) {
          setBoard(prev => {
            const next = [...prev];
            next[move] = aiSymbol;
            return next;
          });
          setIsXNext(prev => !prev);
        }
      }, 400);

      return () => clearTimeout(timer);
    }
  }, [isOpen, board, isHumanTurn, gameMode, gameResult, aiSymbol, humanSymbol]);

  // Update scores on game finish
  useEffect(() => {
    if (!gameResult) return;
    if (gameResult.winner === humanSymbol) {
      setScores(s => ({ ...s, human: s.human + 1 }));
    } else if (gameResult.winner === aiSymbol && gameMode === 'ai') {
      setScores(s => ({ ...s, ai: s.ai + 1 }));
    } else if (gameResult.winner === 'draw') {
      setScores(s => ({ ...s, draws: s.draws + 1 }));
    }
  }, [gameResult?.winner]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCellClick = useCallback((index) => {
    if (board[index] || gameResult || (!isHumanTurn && gameMode === 'ai')) return;

    const currentMark = isXNext ? 'X' : 'O';
    setBoard(prev => {
      const next = [...prev];
      next[index] = currentMark;
      return next;
    });
    setIsXNext(prev => !prev);
  }, [board, gameResult, isHumanTurn, gameMode, isXNext]);

  const handleRestart = () => {
    setBoard(Array(9).fill(null));
    setIsXNext(true);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="ttt-overlay" onClick={onClose}>
        <motion.div 
          className="ttt-card"
          initial={{ opacity: 0, scale: 0.92, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 15 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="ttt-header">
            <div className="ttt-title-wrap">
              <div className="ttt-icon-badge">
                {isOnline ? <Wifi size={18} className="text-emerald" /> : <WifiOff size={18} className="text-amber" />}
              </div>
              <div>
                <h3 className="ttt-title">Network Interrupted — Game Break!</h3>
                <p className="ttt-subtitle">
                  {isOnline 
                    ? "Connection re-established! You can retry your request now." 
                    : "Having trouble connecting. Pass the time with a quick game of Tic-Tac-Toe!"}
                </p>
              </div>
            </div>
            <button className="ttt-close-btn" onClick={onClose} aria-label="Close Game">
              <X size={18} />
            </button>
          </div>

          {/* Online Banner Alert if reconnected */}
          {isOnline && (
            <div className="ttt-online-alert">
              <div className="ttt-online-text">
                <span className="ttt-online-pulse"></span>
                <span>Internet connection is active!</span>
              </div>
              {onRetry && (
                <button 
                  className="ttt-retry-action-btn"
                  onClick={() => {
                    onClose();
                    onRetry();
                  }}
                >
                  <RefreshCw size={13} />
                  <span>Retry Message</span>
                </button>
              )}
            </div>
          )}

          {/* Mode Selector & Scoreboard */}
          <div className="ttt-controls-bar">
            <div className="ttt-mode-switch">
              <button 
                className={`ttt-mode-btn ${gameMode === 'ai' ? 'active' : ''}`}
                onClick={() => { setGameMode('ai'); handleRestart(); }}
              >
                <Bot size={14} /> <span>vs AI</span>
              </button>
              <button 
                className={`ttt-mode-btn ${gameMode === 'pvp' ? 'active' : ''}`}
                onClick={() => { setGameMode('pvp'); handleRestart(); }}
              >
                <User size={14} /> <span>2 Players</span>
              </button>
            </div>

            <div className="ttt-scoreboard">
              <div className="ttt-score-item human">
                <span className="ttt-score-label">{gameMode === 'ai' ? 'You (X)' : 'P1 (X)'}</span>
                <span className="ttt-score-val">{scores.human}</span>
              </div>
              <div className="ttt-score-item draw">
                <span className="ttt-score-label">Draws</span>
                <span className="ttt-score-val">{scores.draws}</span>
              </div>
              <div className="ttt-score-item ai">
                <span className="ttt-score-label">{gameMode === 'ai' ? 'AI (O)' : 'P2 (O)'}</span>
                <span className="ttt-score-val">{scores.ai}</span>
              </div>
            </div>
          </div>

          {/* Game Board */}
          <div className="ttt-board-container">
            <div className="ttt-board">
              {board.map((cell, idx) => {
                const isWinningCell = gameResult?.combo?.includes(idx);
                return (
                  <button
                    key={idx}
                    className={`ttt-cell ${cell ? 'filled' : ''} ${isWinningCell ? 'winning' : ''}`}
                    onClick={() => handleCellClick(idx)}
                    disabled={Boolean(cell || gameResult || (!isHumanTurn && gameMode === 'ai'))}
                    aria-label={`Cell ${idx + 1}`}
                  >
                    {cell === 'X' && (
                      <span className="ttt-symbol-x">X</span>
                    )}
                    {cell === 'O' && (
                      <span className="ttt-symbol-o">O</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Game Status / Result */}
          <div className="ttt-status-bar">
            {gameResult ? (
              <div className="ttt-result-banner">
                {gameResult.winner === 'draw' ? (
                  <span className="ttt-result-text draw">🤝 It's a draw! Well played.</span>
                ) : (
                  <span className="ttt-result-text win">
                    <Trophy size={16} /> 
                    {gameMode === 'ai' 
                      ? (gameResult.winner === humanSymbol ? "🎉 You won! Brilliant move!" : "🤖 AI took this round!")
                      : `🎉 Player ${gameResult.winner} wins!`}
                  </span>
                )}
              </div>
            ) : (
              <div className="ttt-turn-hint">
                {gameMode === 'ai' ? (
                  isHumanTurn ? "Your turn (play as X)" : "AI is calculating..."
                ) : (
                  `Player ${isXNext ? 'X' : 'O'}'s turn`
                )}
              </div>
            )}
          </div>

          {/* Action Footer */}
          <div className="ttt-footer">
            <button className="ttt-reset-btn" onClick={handleRestart}>
              <RotateCcw size={14} />
              <span>Reset Board</span>
            </button>
            <div className="ttt-footer-right">
              {queryToRetry && onRetry && (
                <button 
                  className="ttt-primary-btn" 
                  onClick={() => {
                    onClose();
                    onRetry();
                  }}
                >
                  <RefreshCw size={14} />
                  <span>Retry Question</span>
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
