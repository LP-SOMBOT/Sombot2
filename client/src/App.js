import React, { useState, useEffect, useRef, useContext } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useNavigate, Navigate } from 'react-router-dom';
import { auth, db } from './firebase';
import { onAuthStateChanged, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';

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
  <div>
    <h1>Welcome to NightWaBot</h1>
    <p>The Future of WhatsApp is Simplicity.</p>
    <Link to="/dashboard"><button>Create Your Bot Free</button></Link>
    <Link to="/login"><button>Dashboard Login</button></Link>
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
      setError('');
      setLoading(true);
      await authFunc(auth, emailRef.current.value, passwordRef.current.value);
      navigate('/dashboard');
    } catch (err) {
      setError(errorMsg);
    }
    setLoading(false);
  };

  return (
    <div>
      <h2>Login or Sign Up</h2>
      {error && <p style={{color: '#cf6679'}}>{error}</p>}
      <form onSubmit={(e) => e.preventDefault()}>
        <label>Email</label><input type="email" ref={emailRef} required />
        <label>Password</label><input type="password" ref={passwordRef} required />
        <button disabled={loading} onClick={() => handleAuth(signInWithEmailAndPassword, 'Failed to log in.')}>Log In</button>
        <button disabled={loading} onClick={() => handleAuth(createUserWithEmailAndPassword, 'Failed to sign up.')}>Sign Up</button>
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
    const phone = prompt("Enter WhatsApp number with country code (e.g., 14155552671):");
    if (phone && /^\d+$/.test(phone)) {
      setLoading(true);
      await setDoc(doc(db, 'bots', currentUser.uid), {
        ownerId: currentUser.uid, phoneNumber: phone, status: 'REQUESTING_QR', prefix: '.', pairingCode: null,
      });
    } else {
      alert("Invalid number. Please enter numbers only.");
    }
  };
  
  if (loading) return <h1>Loading...</h1>;

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Welcome, {currentUser.email}</p>
      <button onClick={() => { signOut(auth); navigate('/login'); }}>Log Out</button>
      <hr />
      
      {!botData ? (
        <div>
          <h2>No Bot Found</h2>
          <button onClick={handleCreateBot}>Create Your Bot</button>
        </div>
      ) : (
        <div>
          <h2>Bot Status: <span style={{color: '#bb86fc'}}>{botData.status}</span></h2>
          <p><strong>Phone:</strong> {botData.phoneNumber}</p>
          {botData.status === 'REQUESTING_QR' && botData.pairingCode && (
            <div style={{border: '1px solid #bb86fc', padding: '15px', marginTop: '20px'}}>
              <h3>Enter This Code on WhatsApp:</h3>
              <p>Go to Settings &gt; Linked Devices &gt; Link with phone number.</p>
              <h2 style={{ fontFamily: 'monospace', letterSpacing: '4px', color: '#03dac6' }}>{botData.pairingCode}</h2>
            </div>
          )}
          {botData.status === 'CONNECTED' && <h3 style={{color: '#03dac6'}}>✅ Bot is running!</h3>}
          {botData.status === 'LOGGED_OUT' && <div style={{color: '#cf6679'}}><h3>⚠️ Bot was logged out.</h3><button onClick={handleCreateBot}>Re-Link Bot</button></div>}
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
