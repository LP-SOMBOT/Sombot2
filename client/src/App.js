import React, { useState, useEffect, useRef, useContext } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useNavigate, Navigate } from 'react-router-dom';
import { auth, db } from './firebase';
import { onAuthStateChanged, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';

// --- AUTH CONTEXT ---
const AuthContext = React.createContext();
const useAuth = () => useContext(AuthContext);
const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, user => { setCurrentUser(user); setLoading(false); });
    return unsubscribe;
  }, []);
  const value = { currentUser };
  return <AuthContext.Provider value={value}>{!loading && children}</AuthContext.Provider>;
};

// --- PRIVATE ROUTE ---
const PrivateRoute = ({ children }) => (useAuth().currentUser ? children : <Navigate to="/login" />);

// --- PAGES ---
const HomePage = () => {
    const [title, setTitle] = useState("Simplicity.");
    useEffect(() => {
        const titles = ["Simplicity.", "Automation.", "Control."];
        let i = 0;
        const intervalId = setInterval(() => { i = (i + 1) % titles.length; setTitle(titles[i]); }, 3000);
        return () => clearInterval(intervalId);
    }, []);

    return (
        <div className="bg-[#100e1f] min-h-screen flex flex-col items-center justify-center text-white p-4">
            <div className="text-center w-full max-w-2xl">
                <h1 className="text-5xl md:text-7xl font-bold mb-4">The Future of WhatsApp is <span className="text-purple-400 glow-purple">{title}</span></h1>
                <p className="text-gray-400 text-lg md:text-xl mb-8">Harness the power of Night Wa Bot. Fully customizable, blazingly fast, and managed from a stunning web dashboard.</p>
                <div className="flex justify-center gap-4">
                    <Link to="/dashboard"><button className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-8 rounded-lg transition duration-300">Create Your Bot Free</button></Link>
                    <Link to="/login"><button className="bg-gray-800 hover:bg-gray-700 text-white font-bold py-3 px-8 rounded-lg transition duration-300">Dashboard Login</button></Link>
                </div>
            </div>
        </div>
    );
};

const LoginPage = () => {
  const emailRef = useRef(); const passwordRef = useRef();
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
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
    <div className="bg-[#100e1f] min-h-screen flex items-center justify-center">
        <div className="bg-[#1c1a2e] p-8 rounded-2xl shadow-2xl w-full max-w-md card-glow">
            <h2 className="text-3xl font-bold text-center text-white mb-6">Dashboard <span className="text-purple-400">Login</span></h2>
            {error && <p className="bg-red-500/20 text-red-400 text-center p-3 rounded-lg mb-4">{error}</p>}
            <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
                <input className="w-full bg-[#100e1f] text-white p-3 rounded-lg border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500" type="email" ref={emailRef} required placeholder="Email Address"/>
                <input className="w-full bg-[#100e1f] text-white p-3 rounded-lg border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500" type="password" ref={passwordRef} required placeholder="Password"/>
                <div className="flex gap-4">
                    <button className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 rounded-lg transition duration-300 disabled:opacity-50" disabled={loading} onClick={() => handleAuth(signInWithEmailAndPassword, 'Failed to log in.')}>Log In</button>
                    <button className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 rounded-lg transition duration-300 disabled:opacity-50" disabled={loading} onClick={() => handleAuth(createUserWithEmailAndPassword, 'Failed to sign up.')}>Sign Up</button>
                </div>
            </form>
        </div>
    </div>
  );
};

const DashboardPage = () => {
  const { currentUser } = useAuth(); const navigate = useNavigate();
  const [botData, setBotData] = useState(null); const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'bots', currentUser.uid), (doc) => {
      setBotData(doc.exists() ? doc.data() : null); setLoading(false);
    });
    return unsub;
  }, [currentUser.uid]);

  const handleCreateBot = async () => {
    const phone = prompt("Enter WhatsApp number with country code (e.g., 14155552671). No '+' or spaces.");
    if (phone && /^\d+$/.test(phone)) {
      setLoading(true);
      await setDoc(doc(db, 'bots', currentUser.uid), {
        ownerId: currentUser.uid, phoneNumber: phone, status: 'REQUESTING_QR', prefix: '.',
        pairingCode: null, botMode: 'private', ownerEmail: currentUser.email,
      });
    } else { alert("Invalid number format."); }
  };

  const handleDeleteBot = async () => {
    if (window.confirm("Are you sure? This will permanently delete your bot and its session.")) {
        setLoading(true); await deleteDoc(doc(db, 'bots', currentUser.uid));
    }
  };
  
  if (loading) return <div className="bg-[#100e1f] min-h-screen flex items-center justify-center text-white"><h1>Loading Dashboard...</h1></div>;

  return (
    <div className="bg-[#100e1f] min-h-screen flex items-center justify-center p-4">
      <div className="bg-[#1c1a2e] p-8 rounded-2xl shadow-2xl w-full max-w-md card-glow">
        <h1 className="text-3xl font-bold text-center">Bot <span>Dashboard</span></h1>
        <p className="text-center text-gray-400 mb-4">Welcome, {currentUser.email}</p>
        <button className="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 rounded-lg" onClick={() => { signOut(auth); navigate('/login'); }}>Log Out</button>
        <hr className="border-gray-700 my-6"/>
        
        {!botData ? (
          <div className="text-center">
            <h2 className="text-2xl font-semibold text-white">No Bot Found</h2>
            <p className="text-gray-400 mt-2 mb-4">Click below to link your WhatsApp account.</p>
            <button className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-8 rounded-lg" onClick={handleCreateBot}>Create Your Bot</button>
          </div>
        ) : (
          <div className="text-left space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-white">Status: <span className={botData.status === 'CONNECTED' ? 'text-green-400' : 'text-yellow-400'}>{botData.status}</span></h3>
              <p className="text-gray-400"><strong>Phone:</strong> +{botData.phoneNumber}</p>
              <p className="text-gray-400"><strong>Mode:</strong> {botData.botMode || 'private'}</p>
            </div>
            
            {botData.status === 'REQUESTING_QR' && (
              <div className="bg-[#100e1f] p-4 rounded-lg text-center">
                {botData.pairingCode ? <>
                  <p className="text-gray-300">Enter this code in WhatsApp:</p>
                  <p className="text-3xl font-mono tracking-widest text-green-400 my-2">{botData.pairingCode}</p>
                </> : <p>Requesting pairing code...</p>}
              </div>
            )}

            {botData.status === 'LOGGED_OUT' && <div className="bg-red-500/20 text-red-400 p-3 rounded-lg"><p>⚠️ Bot was logged out.</p><button className="mt-2 text-sm bg-purple-600 px-3 py-1 rounded" onClick={handleCreateBot}>Re-Link</button></div>}
            
            <button className="w-full bg-red-600/50 hover:bg-red-600/70 text-white font-bold py-2 rounded-lg" onClick={handleDeleteBot}>Delete Bot</button>
          </div>
        )}
      </div>
    </div>
  );
};

// --- MAIN APP ---
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
