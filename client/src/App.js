import React, { useState, useEffect, useRef, useContext } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useNavigate, Navigate } from 'react-router-dom';
import { auth, db } from './firebase';
import { onAuthStateChanged, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';

// --- AUTHENTICATION CONTEXT ---
const AuthContext = React.createContext();
const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, user => {
      setCurrentUser(user);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const value = { currentUser };
  return <AuthContext.Provider value={value}>{!loading && children}</AuthContext.Provider>;
};

// --- PRIVATE ROUTE COMPONENT ---
const PrivateRoute = ({ children }) => {
  const { currentUser } = useAuth();
  return currentUser ? children : <Navigate to="/login" />;
};

// --- PAGES ---
const HomePage = () => (
  <div className="card">
    <h1>The Future of WhatsApp is <span>Simplicity.</span></h1>
    <p>Harness the power of your own customizable bot, managed from a stunning web dashboard.</p>
    <Link to="/dashboard"><button className="btn-primary">Create Your Bot Free</button></Link>
    <Link to="/login"><button className="btn-secondary">Dashboard Login</button></Link>
  </div>
);

const LoginPage = () => {
  const emailRef = useRef();
  const passwordRef = useRef();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleAuth = async (authFunc, errorMsg) => {
    try {
      setError(''); setLoading(true);
      await authFunc(auth, emailRef.current.value, passwordRef.current.value);
      navigate('/dashboard');
    } catch (err) { setError(errorMsg); }
    setLoading(false);
  };

  return (
    <div className="card">
      <h2>Dashboard <span>Login</span></h2>
      {error && <p className="status-error">{error}</p>}
      <form onSubmit={(e) => e.preventDefault()}>
        <input type="email" ref={emailRef} required placeholder="Email Address"/>
        <input type="password" ref={passwordRef} required placeholder="Password"/>
        <button className="btn-primary" disabled={loading} onClick={() => handleAuth(signInWithEmailAndPassword, 'Failed to log in.')}>Log In</button>
        <button className="btn-secondary" disabled={loading} onClick={() => handleAuth(createUserWithEmailAndPassword, 'Failed to sign up.')}>Sign Up</button>
      </form>
    </div>
  );
};

const DashboardPage = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [botData, setBotData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'bots', currentUser.uid), (doc) => {
      setBotData(doc.exists() ? doc.data() : null);
      setLoading(false);
    });
    return unsub;
  }, [currentUser.uid]);

  const handleCreateBot = async () => {
    const phone = prompt("Enter WhatsApp number with country code (e.g., 14155552671 for USA). No '+' or spaces.");
    if (phone && /^\d+$/.test(phone)) {
      setLoading(true);
      await setDoc(doc(db, 'bots', currentUser.uid), {
        ownerId: currentUser.uid, phoneNumber: phone, status: 'REQUESTING_QR', prefix: '.', pairingCode: null, botMode: 'public',
      });
    } else { alert("Invalid number. Please enter numbers only."); }
  };

  const handleDeleteBot = async () => {
    if (window.confirm("Are you sure you want to delete your bot? This action cannot be undone.")) {
        setLoading(true);
        await deleteDoc(doc(db, 'bots', currentUser.uid));
        // The onSnapshot listener will automatically update the UI
    }
  };
  
  if (loading) return <h1>Loading...</h1>;

  return (
    <div className="card">
      <h1>Bot <span>Dashboard</span></h1>
      <p>Welcome, {currentUser.email}</p>
      <button className="btn-secondary" onClick={() => { signOut(auth); navigate('/login'); }}>Log Out</button>
      <hr />
      
      {!botData ? (
        <div>
          <h2>No Bot Found</h2>
          <p>Click below to link your WhatsApp and bring your bot to life.</p>
          <button className="btn-primary" onClick={handleCreateBot}>Create Your Bot</button>
        </div>
      ) : (
        <div className="status-box">
          <h3>Bot Status: <span className={botData.status === 'CONNECTED' ? 'status-connected' : 'status-error'}>{botData.status}</span></h3>
          <p><strong>Phone:</strong> {botData.phoneNumber}</p>
          <p><strong>Mode:</strong> {botData.botMode || 'public'}</p>
          
          {botData.status === 'REQUESTING_QR' && botData.pairingCode && (
            <div>
              <p>Go to WhatsApp &gt; Linked Devices &gt; "Link with phone number instead" and enter:</p>
              <h2 className="code">{botData.pairingCode}</h2>
            </div>
          )}

          {botData.status === 'CONNECTED' && <p className="status-connected">✅ Your bot is live and responding to commands!</p>}
          {botData.status === 'LOGGED_OUT' && <div className="status-error"><p>⚠️ Bot was logged out.</p><button className="btn-primary" onClick={handleCreateBot}>Re-Link Bot</button></div>}
          
          <hr/>
          <button className="btn-danger" onClick={handleDeleteBot}>Delete Bot</button>
        </div>
      )}
    </div>
  );
};

// --- MAIN APP COMPONENT ---
export default function App() {
    return (
        <Router>
            <AuthProvider>
                <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/dashboard" element={<PrivateRoute><DashboardPage /></PrivateRoute>} />
                </Routes>
            </AuthProvider>
        </Router>
    );
}
