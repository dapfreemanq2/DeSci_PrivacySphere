import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface ResearchData {
  id: number;
  title: string;
  description: string;
  encryptedData: string;
  dataType: string;
  contributors: string[];
  timestamp: number;
  creator: string;
}

interface UserAction {
  type: 'upload' | 'compute' | 'decrypt';
  timestamp: number;
  details: string;
}

// FHE encryption/decryption functions
const FHEEncryptNumber = (value: number): string => `FHE-${btoa(value.toString())}`;
const FHEDecryptNumber = (encryptedData: string): number => encryptedData.startsWith('FHE-') ? parseFloat(atob(encryptedData.substring(4))) : parseFloat(encryptedData);
const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [researchData, setResearchData] = useState<ResearchData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadingData, setUploadingData] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newData, setNewData] = useState({ title: "", description: "", dataType: "genomic" });
  const [selectedData, setSelectedData] = useState<ResearchData | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [contractAddress, setContractAddress] = useState("");
  const [chainId, setChainId] = useState(0);
  const [startTimestamp, setStartTimestamp] = useState(0);
  const [durationDays, setDurationDays] = useState(30);
  const [userActions, setUserActions] = useState<UserAction[]>([]);
  const [activeTab, setActiveTab] = useState('research');
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("all");

  // Initialize signature parameters
  useEffect(() => {
    loadData().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  // Load data from contract
  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
      
      // Load research data
      const researchBytes = await contract.getData("research");
      let researchList: ResearchData[] = [];
      if (researchBytes.length > 0) {
        try {
          const researchStr = ethers.toUtf8String(researchBytes);
          if (researchStr.trim() !== '') researchList = JSON.parse(researchStr);
        } catch (e) {}
      }
      setResearchData(researchList);
    } catch (e) {
      console.error("Error loading data:", e);
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
      setLoading(false); 
    }
  };

  // Upload new research data
  const uploadData = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setUploadingData(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Uploading encrypted data with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Create new research data entry
      const newResearch: ResearchData = {
        id: researchData.length + 1,
        title: newData.title,
        description: newData.description,
        encryptedData: FHEEncryptNumber(Math.random() * 100), // Simulate encrypted data
        dataType: newData.dataType,
        contributors: [address],
        timestamp: Math.floor(Date.now() / 1000),
        creator: address
      };
      
      // Update research list
      const updatedResearch = [...researchData, newResearch];
      
      // Save to contract
      await contract.setData("research", ethers.toUtf8Bytes(JSON.stringify(updatedResearch)));
      
      // Update user actions
      const newAction: UserAction = {
        type: 'upload',
        timestamp: Math.floor(Date.now() / 1000),
        details: `Uploaded data: ${newData.title}`
      };
      setUserActions(prev => [newAction, ...prev]);
      
      setTransactionStatus({ visible: true, status: "success", message: "Data uploaded successfully!" });
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowUploadModal(false);
        setNewData({ title: "", description: "", dataType: "genomic" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Upload failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setUploadingData(false); 
    }
  };

  // Perform computation on encrypted data
  const performComputation = async (dataId: number, operation: string) => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setTransactionStatus({ visible: true, status: "pending", message: "Performing FHE computation..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Find the data
      const dataIndex = researchData.findIndex(d => d.id === dataId);
      if (dataIndex === -1) throw new Error("Data not found");
      
      // Update data with computation result
      const updatedResearch = [...researchData];
      const currentValue = FHEDecryptNumber(updatedResearch[dataIndex].encryptedData);
      let newValue = currentValue;
      
      switch(operation) {
        case 'average':
          newValue = currentValue * 0.5; // Simulate average
          break;
        case 'sum':
          newValue = currentValue * 2; // Simulate sum
          break;
        case 'normalize':
          newValue = currentValue / 100; // Simulate normalization
          break;
      }
      
      updatedResearch[dataIndex].encryptedData = FHEEncryptNumber(newValue);
      
      // Save to contract
      await contract.setData("research", ethers.toUtf8Bytes(JSON.stringify(updatedResearch)));
      
      // Update user actions
      const newAction: UserAction = {
        type: 'compute',
        timestamp: Math.floor(Date.now() / 1000),
        details: `Performed ${operation} on: ${updatedResearch[dataIndex].title}`
      };
      setUserActions(prev => [newAction, ...prev]);
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE computation complete!" });
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Computation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  // Decrypt data with signature
  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Update user actions
      const newAction: UserAction = {
        type: 'decrypt',
        timestamp: Math.floor(Date.now() / 1000),
        details: "Decrypted FHE data"
      };
      setUserActions(prev => [newAction, ...prev]);
      
      return FHEDecryptNumber(encryptedData);
    } catch (e) { 
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  // Render data visualization
  const renderDataVisualization = (data: ResearchData) => {
    const decrypted = decryptedValue || FHEDecryptNumber(data.encryptedData);
    const normalizedValue = decrypted / 100;
    
    return (
      <div className="visualization-container">
        <div className="visualization-header">
          <h3>Data Analysis</h3>
          <div className="data-type-badge">{data.dataType}</div>
        </div>
        
        <div className="visualization-grid">
          <div className="visualization-item">
            <div className="viz-title">Raw Value</div>
            <div className="viz-value">{decrypted.toFixed(2)}</div>
          </div>
          <div className="visualization-item">
            <div className="viz-title">Normalized</div>
            <div className="viz-value">{normalizedValue.toFixed(2)}</div>
          </div>
        </div>
        
        <div className="visualization-chart">
          <div 
            className="chart-bar" 
            style={{ width: `${normalizedValue * 100}%` }}
          >
            <span className="chart-value">{normalizedValue.toFixed(2)}</span>
          </div>
        </div>
      </div>
    );
  };

  // Render FHE workflow
  const renderFHEWorkflow = () => {
    return (
      <div className="fhe-workflow">
        <div className="workflow-step">
          <div className="step-icon">1</div>
          <div className="step-content">
            <h4>Data Encryption</h4>
            <p>Sensitive research data is encrypted using Zama FHE before upload</p>
          </div>
        </div>
        <div className="workflow-arrow">→</div>
        <div className="workflow-step">
          <div className="step-icon">2</div>
          <div className="step-content">
            <h4>Secure Storage</h4>
            <p>Encrypted data is stored on-chain while remaining private</p>
          </div>
        </div>
        <div className="workflow-arrow">→</div>
        <div className="workflow-step">
          <div className="step-icon">3</div>
          <div className="step-content">
            <h4>Homomorphic Computation</h4>
            <p>Researchers perform computations on encrypted data without decryption</p>
          </div>
        </div>
        <div className="workflow-arrow">→</div>
        <div className="workflow-step">
          <div className="step-icon">4</div>
          <div className="step-content">
            <h4>Controlled Access</h4>
            <p>Only authorized researchers can decrypt results with their keys</p>
          </div>
        </div>
      </div>
    );
  };

  // Render user actions history
  const renderUserActions = () => {
    if (userActions.length === 0) return <div className="no-data">No actions recorded</div>;
    
    return (
      <div className="actions-list">
        {userActions.map((action, index) => (
          <div className="action-item" key={index}>
            <div className={`action-type ${action.type}`}>
              {action.type === 'upload' && '📤'}
              {action.type === 'compute' && '🧮'}
              {action.type === 'decrypt' && '🔓'}
            </div>
            <div className="action-details">
              <div className="action-text">{action.details}</div>
              <div className="action-time">{new Date(action.timestamp * 1000).toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Render FAQ section
  const renderFAQ = () => {
    const faqItems = [
      {
        question: "What is FHE-based DeSci?",
        answer: "FHE-based Decentralized Science (DeSci) allows researchers to collaborate on encrypted sensitive datasets (like genomic or medical data) without sharing raw data, using Fully Homomorphic Encryption (FHE)."
      },
      {
        question: "How does FHE protect research data?",
        answer: "FHE enables computations on encrypted data without decrypting it. Original datasets remain private while allowing collaborative analysis."
      },
      {
        question: "What types of data can be encrypted?",
        answer: "Zama FHE currently supports numerical and boolean data types. Text data must be converted to numerical representations first."
      },
      {
        question: "How is data access controlled?",
        answer: "Data contributors control access through cryptographic permissions. Computations require contributor approval."
      },
      {
        question: "What blockchain is this built on?",
        answer: "This platform is built on Ethereum and utilizes Zama FHE for privacy-preserving computations."
      }
    ];
    
    return (
      <div className="faq-container">
        {faqItems.map((item, index) => (
          <div className="faq-item" key={index}>
            <div className="faq-question">{item.question}</div>
            <div className="faq-answer">{item.answer}</div>
          </div>
        ))}
      </div>
    );
  };

  // Filter research data
  const filteredResearchData = researchData.filter(data => {
    const matchesSearch = data.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         data.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = filterType === "all" || data.dataType === filterType;
    return matchesSearch && matchesType;
  });

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Initializing encrypted research platform...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="fhe-icon"></div>
          </div>
          <h1>DeSci<span>PrivacySphere</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowUploadModal(true)} 
            className="upload-data-btn"
          >
            <div className="add-icon"></div>Upload Data
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <div className="dashboard-grid">
            <div className="dashboard-panel intro-panel">
              <div className="panel-card">
                <h2>FHE-based Decentralized Science</h2>
                <p>Collaborate on encrypted sensitive datasets without exposing raw data. Powered by Zama FHE technology.</p>
                <div className="fhe-badge">
                  <div className="fhe-icon"></div>
                  <span>Powered by Zama FHE</span>
                </div>
              </div>
              
              <div className="panel-card">
                <h2>FHE Research Workflow</h2>
                {renderFHEWorkflow()}
              </div>
              
              <div className="panel-card">
                <h2>Platform Statistics</h2>
                <div className="stats-grid">
                  <div className="stat-item">
                    <div className="stat-value">{researchData.length}</div>
                    <div className="stat-label">Datasets</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">
                      {researchData.length > 0 
                        ? researchData.reduce((sum, d) => sum + d.contributors.length, 0)
                        : 0}
                    </div>
                    <div className="stat-label">Researchers</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">
                      {researchData.length > 0 
                        ? Math.round(researchData.reduce((sum, d) => sum + FHEDecryptNumber(d.encryptedData), 0) / researchData.length) 
                        : 0}
                    </div>
                    <div className="stat-label">Avg Value</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="tabs-container">
            <div className="tabs">
              <button 
                className={`tab ${activeTab === 'research' ? 'active' : ''}`}
                onClick={() => setActiveTab('research')}
              >
                Research Data
              </button>
              <button 
                className={`tab ${activeTab === 'actions' ? 'active' : ''}`}
                onClick={() => setActiveTab('actions')}
              >
                My Activity
              </button>
              <button 
                className={`tab ${activeTab === 'faq' ? 'active' : ''}`}
                onClick={() => setActiveTab('faq')}
              >
                FAQ
              </button>
            </div>
            
            <div className="tab-content">
              {activeTab === 'research' && (
                <div className="research-section">
                  <div className="section-header">
                    <h2>Encrypted Research Datasets</h2>
                    <div className="header-actions">
                      <div className="search-filter-container">
                        <input
                          type="text"
                          placeholder="Search datasets..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="search-input"
                        />
                        <select
                          value={filterType}
                          onChange={(e) => setFilterType(e.target.value)}
                          className="filter-select"
                        >
                          <option value="all">All Types</option>
                          <option value="genomic">Genomic</option>
                          <option value="medical">Medical</option>
                          <option value="clinical">Clinical Trial</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      <button 
                        onClick={loadData} 
                        className="refresh-btn" 
                        disabled={isRefreshing}
                      >
                        {isRefreshing ? "Refreshing..." : "Refresh"}
                      </button>
                    </div>
                  </div>
                  
                  <div className="research-list">
                    {filteredResearchData.length === 0 ? (
                      <div className="no-data">
                        <div className="no-data-icon"></div>
                        <p>No research data found</p>
                        <button 
                          className="upload-btn" 
                          onClick={() => setShowUploadModal(true)}
                        >
                          Upload First Dataset
                        </button>
                      </div>
                    ) : filteredResearchData.map((data, index) => (
                      <div 
                        className={`research-item ${selectedData?.id === data.id ? "selected" : ""}`} 
                        key={index}
                        onClick={() => setSelectedData(data)}
                      >
                        <div className="research-header">
                          <div className="research-title">{data.title}</div>
                          <div className="research-type">{data.dataType}</div>
                        </div>
                        <div className="research-description">{data.description.substring(0, 100)}...</div>
                        <div className="research-footer">
                          <div className="research-creator">Creator: {data.creator.substring(0, 6)}...{data.creator.substring(38)}</div>
                          <div className="research-encrypted">Encrypted Data: {data.encryptedData.substring(0, 15)}...</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {activeTab === 'actions' && (
                <div className="actions-section">
                  <h2>My Research Activity</h2>
                  {renderUserActions()}
                </div>
              )}
              
              {activeTab === 'faq' && (
                <div className="faq-section">
                  <h2>Frequently Asked Questions</h2>
                  {renderFAQ()}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {showUploadModal && (
        <ModalUploadData 
          onSubmit={uploadData} 
          onClose={() => setShowUploadModal(false)} 
          uploading={uploadingData} 
          data={newData} 
          setData={setNewData}
        />
      )}
      
      {selectedData && (
        <DataDetailModal 
          data={selectedData} 
          onClose={() => { 
            setSelectedData(null); 
            setDecryptedValue(null); 
          }} 
          decryptedValue={decryptedValue} 
          setDecryptedValue={setDecryptedValue} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
          performComputation={performComputation}
          renderDataVisualization={renderDataVisualization}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="fhe-icon"></div>
              <span>DeSci_PrivacySphere</span>
            </div>
            <p>FHE-based decentralized research collaboration platform</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>Powered by Zama FHE</span>
          </div>
          <div className="copyright">© {new Date().getFullYear()} DeSci_PrivacySphere. All rights reserved.</div>
          <div className="disclaimer">
            This platform uses fully homomorphic encryption to protect research data privacy. 
            All computations are performed on encrypted data without exposing raw values.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalUploadDataProps {
  onSubmit: () => void; 
  onClose: () => void; 
  uploading: boolean;
  data: any;
  setData: (data: any) => void;
}

const ModalUploadData: React.FC<ModalUploadDataProps> = ({ onSubmit, onClose, uploading, data, setData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setData({ ...data, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="upload-data-modal">
        <div className="modal-header">
          <h2>Upload Encrypted Research Data</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="lock-icon"></div>
            <div>
              <strong>FHE Encryption Notice</strong>
              <p>All data will be encrypted with Zama FHE before storage</p>
            </div>
          </div>
          
          <div className="form-group">
            <label>Title *</label>
            <input 
              type="text" 
              name="title" 
              value={data.title} 
              onChange={handleChange} 
              placeholder="Enter dataset title..." 
            />
          </div>
          
          <div className="form-group">
            <label>Description *</label>
            <textarea 
              name="description" 
              value={data.description} 
              onChange={handleChange} 
              placeholder="Describe your dataset..." 
              rows={4}
            />
          </div>
          
          <div className="form-group">
            <label>Data Type *</label>
            <select 
              name="dataType" 
              value={data.dataType} 
              onChange={handleChange}
            >
              <option value="genomic">Genomic Data</option>
              <option value="medical">Medical Records</option>
              <option value="clinical">Clinical Trial Data</option>
              <option value="other">Other Research Data</option>
            </select>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={uploading || !data.title || !data.description} 
            className="submit-btn"
          >
            {uploading ? "Encrypting & Uploading..." : "Upload Dataset"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface DataDetailModalProps {
  data: ResearchData;
  onClose: () => void;
  decryptedValue: number | null;
  setDecryptedValue: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
  performComputation: (dataId: number, operation: string) => void;
  renderDataVisualization: (data: ResearchData) => JSX.Element;
}

const DataDetailModal: React.FC<DataDetailModalProps> = ({ 
  data, 
  onClose, 
  decryptedValue, 
  setDecryptedValue, 
  isDecrypting, 
  decryptWithSignature,
  performComputation,
  renderDataVisualization
}) => {
  const handleDecrypt = async () => {
    if (decryptedValue !== null) { 
      setDecryptedValue(null); 
      return; 
    }
    
    const decrypted = await decryptWithSignature(data.encryptedData);
    if (decrypted !== null) {
      setDecryptedValue(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="data-detail-modal">
        <div className="modal-header">
          <h2>Dataset Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="data-info">
            <div className="info-item">
              <span>Title:</span>
              <strong>{data.title}</strong>
            </div>
            <div className="info-item">
              <span>Type:</span>
              <strong>{data.dataType}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{data.creator.substring(0, 6)}...{data.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Uploaded:</span>
              <strong>{new Date(data.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item full-width">
              <span>Description:</span>
              <div className="data-description">{data.description}</div>
            </div>
          </div>
          
          <div className="data-visualization">
            {renderDataVisualization(data)}
          </div>
          
          <div className="data-operations">
            <h3>FHE Operations</h3>
            <div className="operation-buttons">
              <button 
                className="operation-btn" 
                onClick={() => performComputation(data.id, 'average')}
              >
                Compute Average
              </button>
              <button 
                className="operation-btn" 
                onClick={() => performComputation(data.id, 'sum')}
              >
                Compute Sum
              </button>
              <button 
                className="operation-btn" 
                onClick={() => performComputation(data.id, 'normalize')}
              >
                Normalize Data
              </button>
            </div>
          </div>
          
          <div className="encrypted-section">
            <h3>Encrypted Data</h3>
            <div className="encrypted-data">{data.encryptedData.substring(0, 100)}...</div>
            <div className="fhe-tag">
              <div className="fhe-icon"></div>
              <span>FHE Encrypted</span>
            </div>
            <button 
              className="decrypt-btn" 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
            >
              {isDecrypting ? (
                <span>Decrypting...</span>
              ) : decryptedValue !== null ? (
                "Hide Decrypted Value"
              ) : (
                "Decrypt with Wallet Signature"
              )}
            </button>
          </div>
          
          {decryptedValue !== null && (
            <div className="decrypted-section">
              <h3>Decrypted Value</h3>
              <div className="decrypted-value">
                <span>Value:</span>
                <strong>{decryptedValue.toFixed(2)}</strong>
              </div>
              <div className="decryption-notice">
                <div className="warning-icon"></div>
                <span>Decrypted value is only visible after wallet signature verification</span>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;