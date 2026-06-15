"use client";

import React, { useState, useEffect } from 'react';

export default function Home() {
  const [currentTab, setCurrentTab] = useState("dashboard"); // "dashboard" | "import"
  
  // Dashboard state
  const [users, setUsers] = useState([]);
  const [balances, setBalances] = useState([]);
  const [settlementPaths, setSettlementPaths] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [selectedAuditUser, setSelectedAuditUser] = useState(null);
  const [auditTrail, setAuditTrail] = useState([]);
  
  // Anomaly/Import state
  const [anomalies, setAnomalies] = useState([]);
  const [uploadMessage, setUploadMessage] = useState("");
  const [importReport, setImportReport] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  
  // Add Expense form state
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    amount: "",
    currency: "INR",
    description: "",
    expenseDate: new Date().toISOString().split('T')[0],
    paidById: "",
    splitType: "equal",
    splitMembers: [],
    splitDetails: "" // For percentages or shares
  });
  
  // Add Settlement form state
  const [showAddSettlement, setShowAddSettlement] = useState(false);
  const [settlementForm, setSettlementForm] = useState({
    payerId: "",
    payeeId: "",
    amount: "",
    currency: "INR",
    settlementDate: new Date().toISOString().split('T')[0]
  });

  // Fetch initial data
  useEffect(() => {
    fetchUsers();
    fetchBalances();
    fetchSettlementPaths();
    fetchExpenses();
    fetchAnomalies();
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/users");
      const data = await res.json();
      setUsers(data);
      if (data.length > 0 && !expenseForm.paidById) {
        setExpenseForm(prev => ({ ...prev, paidById: data[0].id.toString() }));
        setSettlementForm(prev => ({ ...prev, payerId: data[0].id.toString(), payeeId: data[1] ? data[1].id.toString() : data[0].id.toString() }));
      }
    } catch (err) {
      console.error("Error fetching users:", err);
    }
  };

  const fetchBalances = async () => {
    try {
      const res = await fetch("/api/expenses/balances?group_id=1");
      const data = await res.json();
      setBalances(data);
    } catch (err) {
      console.error("Error fetching balances:", err);
    }
  };

  const fetchSettlementPaths = async () => {
    try {
      const res = await fetch("/api/expenses/settlements-path?group_id=1");
      const data = await res.json();
      setSettlementPaths(data);
    } catch (err) {
      console.error("Error fetching settlement paths:", err);
    }
  };

  const fetchExpenses = async () => {
    try {
      const res = await fetch("/api/expenses?group_id=1&verified_only=true");
      const data = await res.json();
      setExpenses(data);
    } catch (err) {
      console.error("Error fetching expenses:", err);
    }
  };

  const fetchAnomalies = async () => {
    try {
      const res = await fetch("/api/imports/anomalies");
      const data = await res.json();
      setAnomalies(data);
    } catch (err) {
      console.error("Error fetching anomalies:", err);
    }
  };

  const handleAuditClick = async (user) => {
    setSelectedAuditUser(user);
    try {
      const res = await fetch(`/api/expenses/audit/${user.user_id}?group_id=1`);
      const data = await res.json();
      setAuditTrail(data);
      
      // Auto-scroll to audit log
      setTimeout(() => {
        document.getElementById("audit-section")?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } catch (err) {
      console.error("Error fetching audit trail:", err);
    }
  };

  // CSV File Uploader
  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) {
      setUploadMessage("Please select a CSV file first.");
      return;
    }

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      setUploadMessage("Uploading and analyzing CSV...");
      const res = await fetch("/api/imports/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Import failed");
      
      const data = await res.json();
      setImportReport(data);
      setUploadMessage(`Success! CSV imported. Staged ${data.total_rows} rows. Found ${data.anomalies_found} anomalies requiring review.`);
      
      // Refresh database states
      fetchUsers();
      fetchBalances();
      fetchSettlementPaths();
      fetchExpenses();
      fetchAnomalies();
    } catch (err) {
      setUploadMessage("Error uploading CSV: " + err.message);
    }
  };

  // Resolve CSV anomalies
  const handleResolveAnomaly = async (anomalyId, choice) => {
    try {
      const res = await fetch(`/api/imports/anomalies/${anomalyId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(choice)
      });
      
      if (!res.ok) throw new Error("Resolution failed");
      
      // Refresh list of anomalies and balance states
      fetchAnomalies();
      fetchBalances();
      fetchSettlementPaths();
      fetchExpenses();
      
      if (selectedAuditUser) {
        handleAuditClick(selectedAuditUser);
      }
    } catch (err) {
      alert("Error resolving anomaly: " + err.message);
    }
  };

  // Add Custom Expense submit
  const handleAddExpenseSubmit = async (e) => {
    e.preventDefault();
    
    // Auto-calculate equal splits if empty
    const members = expenseForm.splitMembers.length > 0 
      ? expenseForm.splitMembers 
      : users.map(u => u.id); // default to all
      
    const rawAmt = parseFloat(expenseForm.amount);
    if (isNaN(rawAmt) || rawAmt <= 0) {
      alert("Please enter a valid amount");
      return;
    }

    let splits = [];
    if (expenseForm.splitType === "equal") {
      const share = rawAmt / members.length;
      splits = members.map(uid => ({
        user_id: uid,
        amount_owed: parseFloat(share.toFixed(2))
      }));
    } else if (expenseForm.splitType === "percentage") {
      // splitDetails: Aisha 40; Rohan 60
      const parsedDetails = expenseForm.splitDetails.split(';').map(s => s.trim().split(/\s+/));
      splits = parsedDetails.map(([name, pct]) => {
        const u = users.find(usr => usr.username.toLowerCase() === name.toLowerCase());
        const pctVal = parseFloat(pct) || 0;
        return {
          user_id: u ? u.id : users[0].id,
          amount_owed: parseFloat(((rawAmt * pctVal) / 100).toFixed(2)),
          percentage: pctVal
        };
      });
    } else if (expenseForm.splitType === "share") {
      const parsedDetails = expenseForm.splitDetails.split(';').map(s => s.trim().split(/\s+/));
      const totalShares = parsedDetails.reduce((acc, [, sh]) => acc + (parseFloat(sh) || 0), 0);
      splits = parsedDetails.map(([name, sh]) => {
        const u = users.find(usr => usr.username.toLowerCase() === name.toLowerCase());
        const shareVal = parseFloat(sh) || 0;
        const owed = totalShares > 0 ? (rawAmt * shareVal) / totalShares : 0;
        return {
          user_id: u ? u.id : users[0].id,
          amount_owed: parseFloat(owed.toFixed(2)),
          share: shareVal
        };
      });
    }

    const payload = {
      amount: rawAmt,
      currency: expenseForm.currency,
      description: expenseForm.description,
      expense_date: expenseForm.expenseDate,
      split_type: expenseForm.splitType,
      paid_by_id: parseInt(expenseForm.paidById),
      splits: splits,
      notes: ""
    };

    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error("Failed to add expense");
      
      setShowAddExpense(false);
      // reset form
      setExpenseForm(prev => ({
        ...prev,
        amount: "",
        description: "",
        splitMembers: [],
        splitDetails: ""
      }));
      
      // refresh
      fetchExpenses();
      fetchBalances();
      fetchSettlementPaths();
    } catch (err) {
      alert("Error saving expense: " + err.message);
    }
  };

  // Add Direct Settlement submit
  const handleAddSettlementSubmit = async (e) => {
    e.preventDefault();
    const rawAmt = parseFloat(settlementForm.amount);
    if (isNaN(rawAmt) || rawAmt <= 0) {
      alert("Please enter a valid amount");
      return;
    }
    
    if (settlementForm.payerId === settlementForm.payeeId) {
      alert("Payer and Payee cannot be the same person");
      return;
    }

    const payload = {
      group_id: 1,
      payer_id: parseInt(settlementForm.payerId),
      payee_id: parseInt(settlementForm.payeeId),
      amount: rawAmt,
      currency: settlementForm.currency,
      settlement_date: settlementForm.settlementDate,
      is_approved: true
    };

    try {
      const res = await fetch("/api/settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error("Failed to record settlement");
      
      setShowAddSettlement(false);
      setSettlementForm(prev => ({ ...prev, amount: "" }));
      
      fetchBalances();
      fetchSettlementPaths();
    } catch (err) {
      alert("Error saving settlement: " + err.message);
    }
  };

  const toggleSplitMember = (userId) => {
    setExpenseForm(prev => {
      const idx = prev.splitMembers.indexOf(userId);
      let newMembers = [...prev.splitMembers];
      if (idx > -1) {
        newMembers.splice(idx, 1);
      } else {
        newMembers.push(userId);
      }
      return { ...prev, splitMembers: newMembers };
    });
  };

  return (
    <div className="app-container animate-fade-in">
      <header>
        <div className="logo-section">
          <div className="logo-icon">S</div>
          <div className="logo-text">Spreetail Split (Next.js)</div>
        </div>
        <div className="badge badge-info">Relational SQLite DB Connected</div>
      </header>

      {/* Navigation tabs */}
      <div className="nav-tabs">
        <button 
          className={`nav-tab ${currentTab === "dashboard" ? "active" : ""}`}
          onClick={() => setCurrentTab("dashboard")}
        >
          📊 Dashboard & Balances
        </button>
        <button 
          className={`nav-tab ${currentTab === "import" ? "active" : ""}`}
          onClick={() => setCurrentTab("import")}
        >
          ⚡ CSV Import Wizard
          {anomalies.length > 0 && (
            <span className="badge badge-danger" style={{ marginLeft: '8px', padding: '0.15rem 0.4rem' }}>
              {anomalies.length}
            </span>
          )}
        </button>
      </div>

      {/* DASHBOARD TAB */}
      {currentTab === "dashboard" && (
        <div className="animate-fade-in-up">
          {/* Timeline / Group Membership Info banner */}
          <div className="card" style={{ marginBottom: '2rem', background: 'linear-gradient(135deg, hsla(217, 33%, 16%, 0.9), hsla(222, 47%, 10%, 0.8))' }}>
            <h3>👥 Group Memberships & Timelines</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              To ensure fairness, splits are calculated automatically using member entry and departure dates. Sam does not pay for March expenses, and Meera does not split April expenses.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
              <div style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-sm)' }}>
                <strong style={{ color: 'var(--primary)' }}>Aisha, Rohan, Priya</strong>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>Active since Feb 1</div>
              </div>
              <div style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-sm)' }}>
                <strong style={{ color: '#ff7a7a' }}>Meera</strong>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>Moved Out: Mar 31</div>
              </div>
              <div style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-sm)' }}>
                <strong style={{ color: '#ffd25e' }}>Sam</strong>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>Moved In: Apr 15</div>
              </div>
              <div style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-sm)' }}>
                <strong style={{ color: 'var(--secondary)' }}>Dev</strong>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>Visiting: Mar 8 - Mar 15</div>
              </div>
            </div>
          </div>

          <div className="dashboard-grid">
            {/* LEFT COLUMN: Balances and simplified payments */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              
              {/* Balances Sheet */}
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                  <h2>💰 Individual Balances Summary</h2>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn btn-secondary" onClick={() => setShowAddExpense(true)}>+ Add Expense</button>
                    <button className="btn btn-secondary" onClick={() => setShowAddSettlement(true)}>+ Settle Debt</button>
                  </div>
                </div>
                
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1rem', marginTop: '-0.5rem' }}>
                  💡 Click any flatmate's row to view their itemized transaction history and audit their balance.
                </p>

                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Flatmate</th>
                        <th>Total Paid (INR)</th>
                        <th>Total Share (INR)</th>
                        <th>Net Balance (INR)</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {balances.map(b => (
                        <tr 
                          key={b.user_id} 
                          onClick={() => handleAuditClick(b)}
                          style={{ cursor: 'pointer', background: selectedAuditUser?.user_id === b.user_id ? 'hsla(172, 95%, 43%, 0.1)' : '' }}
                        >
                          <td style={{ fontWeight: '600' }}>{b.username}</td>
                          <td>₹{b.paid_amount.toLocaleString('en-IN')}</td>
                          <td>₹{b.share_amount.toLocaleString('en-IN')}</td>
                          <td className={b.net_balance > 0.01 ? "amount-positive" : b.net_balance < -0.01 ? "amount-negative" : "amount-neutral"}>
                            {b.net_balance > 0 ? "+" : ""}{b.net_balance.toLocaleString('en-IN')}
                          </td>
                          <td>
                            {b.net_balance > 0.01 ? (
                              <span className="badge badge-success">Is Owed</span>
                            ) : b.net_balance < -0.01 ? (
                              <span className="badge badge-danger">Owes Money</span>
                            ) : (
                              <span className="badge badge-info">Settled</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Verified Expenses List */}
              <div className="card">
                <h2>📜 Verified Expenses Log</h2>
                {expenses.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)' }}>No verified expenses found. Upload a CSV file or add expenses manually to populate the log.</p>
                ) : (
                  <div className="table-container" style={{ maxHeight: '450px' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Description</th>
                          <th>Paid By</th>
                          <th>Amount (INR)</th>
                          <th>Split Type</th>
                          <th>Splits Owed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expenses.map(e => (
                          <tr key={e.id}>
                            <td>{e.expense_date}</td>
                            <td style={{ fontWeight: '500' }}>
                              {e.description}
                              {e.notes && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '400' }}>{e.notes}</div>}
                            </td>
                            <td>{e.paid_by?.username || "Unknown"}</td>
                            <td style={{ fontWeight: '600' }}>₹{e.amount.toLocaleString('en-IN')}</td>
                            <td><span className="badge badge-info">{e.split_type}</span></td>
                            <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                              {e.splits?.map(s => `${s.user?.username}: ₹${s.amount_owed}`).join('; ') || "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT COLUMN: Aisha's simplified paths */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              <div className="card" style={{ borderLeft: '4px solid var(--primary)' }}>
                <h2>✨ Aisha's Settlement Guide</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
                  Simplifies transactions so that everyone pays the absolute minimum number of direct settlements.
                </p>

                {settlementPaths.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '1.5rem', background: 'rgba(0,0,0,0.15)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ fontSize: '2rem' }}>🎉</div>
                    <strong style={{ color: 'var(--success)' }}>All balances settled!</strong>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>Nobody owes anything to anyone.</div>
                  </div>
                ) : (
                  <div className="item-list">
                    {settlementPaths.map((path, idx) => (
                      <div key={idx} className="item-row">
                        <div>
                          <strong style={{ color: 'var(--danger)' }}>{path.from_user.username}</strong>
                          <span style={{ color: 'var(--text-secondary)', margin: '0 0.5rem' }}>pays</span>
                          <strong style={{ color: 'var(--success)' }}>{path.to_user.username}</strong>
                        </div>
                        <div style={{ fontWeight: '700', color: 'var(--text-primary)', fontSize: '1.1rem' }}>
                          ₹{path.amount.toLocaleString('en-IN')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Rohan's audit trail display */}
          {selectedAuditUser && (
            <div id="audit-section" className="card animate-fade-in" style={{ marginTop: '2rem', borderTop: '4px solid var(--secondary)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div>
                  <h2>🔍 Rohan's Trace: Balance Audit Trail</h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    Itemized list for <strong>{selectedAuditUser.username}</strong>. Sum of credits (positive) and charges (negative) matches the balance sheet exactly.
                  </p>
                </div>
                <button className="btn btn-secondary" onClick={() => setSelectedAuditUser(null)}>Close Trace</button>
              </div>

              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Description</th>
                      <th>Original Amount</th>
                      <th>Share details</th>
                      <th>Converted to INR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditTrail.map((item, idx) => {
                      const isCredit = item.type === "expense_payment" || item.type === "settlement_sent";
                      return (
                        <tr key={idx}>
                          <td>{item.date}</td>
                          <td>
                            <span className={`badge ${isCredit ? 'badge-success' : 'badge-danger'}`}>
                              {item.type.replace('_', ' ')}
                            </span>
                          </td>
                          <td style={{ fontWeight: '500' }}>
                            {item.description}
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '400' }}>{item.details}</div>
                          </td>
                          <td style={{ fontFamily: 'var(--font-display)' }}>
                            {item.original_currency} {item.original_amount.toLocaleString('en-IN')}
                          </td>
                          <td>{item.share_ratio || "-"}</td>
                          <td className={isCredit ? "amount-positive" : "amount-negative"} style={{ fontWeight: '600' }}>
                            {isCredit ? "+" : "-"}₹{item.converted_amount.toLocaleString('en-IN')}
                          </td>
                        </tr>
                      );
                    })}
                    <tr style={{ background: 'rgba(0,0,0,0.3)', borderTop: '2px solid var(--border-color)', fontWeight: '700' }}>
                      <td colSpan="5" style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontSize: '1rem' }}>Total Audit Net Balance:</td>
                      <td className={selectedAuditUser.net_balance > 0.01 ? "amount-positive" : selectedAuditUser.net_balance < -0.01 ? "amount-negative" : "amount-neutral"} style={{ fontSize: '1.1rem' }}>
                        {selectedAuditUser.net_balance > 0 ? "+" : ""}{selectedAuditUser.net_balance.toLocaleString('en-IN')}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* IMPORT WIZARD TAB */}
      {currentTab === "import" && (
        <div className="animate-fade-in-up" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          {/* Upload panel */}
          <div className="card">
            <h2>📥 Import Spreadsheet Export CSV</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              Select the raw spreadsheet export file (e.g., <code>Expenses Export - Expenses Export.csv</code>). The app will run our 12+ anomaly scanners to extract rent schedules, multi-currency conversions, timeline exclusions, and duplicated records.
            </p>

            <form onSubmit={handleFileUpload} style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
              <input 
                type="file" 
                accept=".csv"
                onChange={(e) => setSelectedFile(e.target.files[0])}
                style={{ width: 'auto', flex: 1, minWidth: '250px' }}
              />
              <button type="submit" className="btn btn-primary">Analyze & Stage CSV</button>
            </form>

            {uploadMessage && (
              <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                <p style={{ fontSize: '0.95rem', fontWeight: '500', color: 'var(--text-primary)' }}>{uploadMessage}</p>
              </div>
            )}
          </div>

          {/* Anomaly Resolution Manager */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2>⚠️ CSV Anomalies Action Review Board</h2>
              <span className="badge badge-danger">{anomalies.length} Pending Review</span>
            </div>
            
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.5rem', marginTop: '-0.5rem' }}>
              ⚠️ Meera's Approval Rule: All items listed below have anomalies that would skew balances. You must click a resolution path to apply fixes and approve their import into the database.
            </p>

            {anomalies.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem', background: 'rgba(0,0,0,0.15)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>✨</div>
                <h3 style={{ color: 'var(--success)' }}>All Clear! No Pending Anomalies</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Upload a messy CSV or resolve outstanding items above. All data is normalized!</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {anomalies.map((anom) => (
                  <div key={anom.id} style={{ padding: '1.25rem', background: 'hsla(355, 85%, 60%, 0.05)', border: '1px solid hsla(355, 85%, 60%, 0.2)', borderRadius: 'var(--radius-sm)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    
                    {/* Header: row and type */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <strong>Row {anom.row_number}: {anom.description_raw || "Unnamed expense"}</strong>
                      <span className="badge badge-danger">{anom.anomaly_type.replace(/_/g, ' ')}</span>
                    </div>

                    {/* Metadata details */}
                    <div style={{ fontSize: '0.85rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem', color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.2)', padding: '0.75rem', borderRadius: '4px' }}>
                      <div>📅 Date: <code>{anom.date_raw}</code></div>
                      <div>💰 Amount: <code>{anom.amount_raw}</code></div>
                      <div>💵 Currency: <code>{anom.currency_raw || "None"}</code></div>
                      <div>👤 Paid by: <code>{anom.paid_by_raw || "None"}</code></div>
                      <div>📊 Split: <code>{anom.split_type_raw}</code></div>
                      <div>👥 Members: <code style={{ fontSize: '0.75rem' }}>{anom.split_with_raw}</code></div>
                    </div>

                    {/* Anomaly Description */}
                    <div>
                      <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                        <strong>Problem detected:</strong> {anom.description}
                      </p>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                        💡 <strong>Suggested fix:</strong> {anom.suggested_resolution}
                      </p>
                    </div>

                    {/* Resolution Choice Action Buttons */}
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', borderTop: '1px dashed var(--border-color)', paddingTop: '1rem' }}>
                      {anom.anomaly_type === "exact_duplicate" && (
                        <>
                          <button className="btn btn-danger" onClick={() => handleResolveAnomaly(anom.id, { action: "delete" })}>
                            Delete Duplicate
                          </button>
                          <button className="btn btn-secondary" onClick={() => handleResolveAnomaly(anom.id, { action: "keep" })}>
                            Keep both anyway
                          </button>
                        </>
                      )}

                      {anom.anomaly_type === "conflicting_duplicate" && (
                        <>
                          <button className="btn btn-primary" onClick={() => handleResolveAnomaly(anom.id, { action: "keep" })}>
                            Keep (Approve)
                          </button>
                          <button className="btn btn-danger" onClick={() => handleResolveAnomaly(anom.id, { action: "delete" })}>
                            Delete conflicting entry
                          </button>
                        </>
                      )}

                      {anom.anomaly_type === "missing_payer" && (
                        <>
                          {users.map(u => (
                            <button key={u.id} className="btn btn-secondary btn-sm" onClick={() => handleResolveAnomaly(anom.id, { action: "set_payer", user_id: u.id })}>
                              Paid by {u.username}
                            </button>
                          ))}
                        </>
                      )}

                      {anom.anomaly_type === "settlement_logged_as_expense" && (
                        <button className="btn btn-primary" onClick={() => handleResolveAnomaly(anom.id, { action: "approve" })}>
                          Convert and import as Settlement record
                        </button>
                      )}

                      {anom.anomaly_type === "inactive_member_split" && (
                        <>
                          {anom.split_with_raw?.includes("Meera") && (
                            <button className="btn btn-primary" onClick={() => handleResolveAnomaly(anom.id, { action: "exclude_user", exclude_username: "Meera" })}>
                              Exclude Meera (Recalculate Split)
                            </button>
                          )}
                          {anom.split_with_raw?.includes("Sam") && (
                            <button className="btn btn-primary" onClick={() => handleResolveAnomaly(anom.id, { action: "exclude_user", exclude_username: "Sam" })}>
                              Exclude Sam (Recalculate Split)
                            </button>
                          )}
                          <button className="btn btn-secondary" onClick={() => handleResolveAnomaly(anom.id, { action: "force_split" })}>
                            Keep split list as-is
                          </button>
                        </>
                      )}

                      {anom.anomaly_type === "percentage_sum_mismatch" && (
                        <button className="btn btn-primary" onClick={() => handleResolveAnomaly(anom.id, { action: "normalize" })}>
                          Normalize percentages to 100% proportionally
                        </button>
                      )}

                      {anom.anomaly_type === "split_type_detail_mismatch" && (
                        <button className="btn btn-primary" onClick={() => handleResolveAnomaly(anom.id, { action: "approve" })}>
                          Apply details as custom Share split
                        </button>
                      )}

                      {/* Fallback general approval for other types */}
                      {![
                        "exact_duplicate",
                        "conflicting_duplicate",
                        "missing_payer",
                        "settlement_logged_as_expense",
                        "inactive_member_split",
                        "percentage_sum_mismatch",
                        "split_type_detail_mismatch"
                      ].includes(anom.anomaly_type) && (
                        <button className="btn btn-primary" onClick={() => handleResolveAnomaly(anom.id, { action: "approve" })}>
                          Approve Recommended Resolution
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* DIALOG: ADD EXPENSE */}
      {showAddExpense && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1rem' }} className="animate-fade-in">
          <div className="card" style={{ maxWidth: '500px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2>Log New Shared Expense</h2>
              <button className="btn btn-secondary" onClick={() => setShowAddExpense(false)}>Cancel</button>
            </div>
            
            <form onSubmit={handleAddExpenseSubmit}>
              <div className="form-group">
                <label className="form-label">Description</label>
                <input 
                  type="text" 
                  required
                  placeholder="e.g. Electricity bill, Dinner"
                  value={expenseForm.description}
                  onChange={(e) => setExpenseForm(prev => ({ ...prev, description: e.target.value }))}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Amount</label>
                  <input 
                    type="number" 
                    step="0.01"
                    required
                    placeholder="0.00"
                    value={expenseForm.amount}
                    onChange={(e) => setExpenseForm(prev => ({ ...prev, amount: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Currency</label>
                  <select 
                    value={expenseForm.currency}
                    onChange={(e) => setExpenseForm(prev => ({ ...prev, currency: e.target.value }))}
                  >
                    <option value="INR">INR (₹)</option>
                    <option value="USD">USD ($)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Date</label>
                  <input 
                    type="date" 
                    required
                    value={expenseForm.expenseDate}
                    onChange={(e) => setExpenseForm(prev => ({ ...prev, expenseDate: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Paid By</label>
                  <select 
                    value={expenseForm.paidById}
                    onChange={(e) => setExpenseForm(prev => ({ ...prev, paidById: e.target.value }))}
                  >
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.username}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Split Type</label>
                <select 
                  value={expenseForm.splitType}
                  onChange={(e) => setExpenseForm(prev => ({ ...prev, splitType: e.target.value }))}
                >
                  <option value="equal">Split Equally</option>
                  <option value="percentage">Split by Percentages</option>
                  <option value="share">Split by Shares</option>
                </select>
              </div>

              {expenseForm.splitType === "equal" ? (
                <div className="form-group">
                  <label className="form-label">Split With (Select Members)</label>
                  <div className="user-pills">
                    {users.map(u => {
                      const isActive = expenseForm.splitMembers.includes(u.id);
                      return (
                        <div 
                          key={u.id} 
                          className={`user-pill ${isActive ? 'active' : ''}`}
                          onClick={() => toggleSplitMember(u.id)}
                        >
                          {u.username}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>* If none selected, defaults to all active flatmates.</div>
                </div>
              ) : (
                <div className="form-group">
                  <label className="form-label">
                    Split Details ({expenseForm.splitType === "percentage" ? "Percentages" : "Shares"})
                  </label>
                  <textarea
                    rows="2"
                    required
                    placeholder={expenseForm.splitType === "percentage" ? "e.g. Aisha 30; Rohan 40; Priya 30" : "e.g. Aisha 1; Rohan 2; Priya 1"}
                    value={expenseForm.splitDetails}
                    onChange={(e) => setExpenseForm(prev => ({ ...prev, splitDetails: e.target.value }))}
                  />
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    * Format: Semicolon separated name-value pairs, e.g. <code>Aisha 30; Rohan 70</code>
                  </div>
                </div>
              )}

              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}>
                Save Expense
              </button>
            </form>
          </div>
        </div>
      )}

      {/* DIALOG: ADD SETTLEMENT */}
      {showAddSettlement && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1rem' }} className="animate-fade-in">
          <div className="card" style={{ maxWidth: '450px', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2>Record Direct Settlement Payment</h2>
              <button className="btn btn-secondary" onClick={() => setShowAddSettlement(false)}>Cancel</button>
            </div>
            
            <form onSubmit={handleAddSettlementSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Payer (Who Paid)</label>
                  <select 
                    value={settlementForm.payerId}
                    onChange={(e) => setSettlementForm(prev => ({ ...prev, payerId: e.target.value }))}
                  >
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.username}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Payee (Who Received)</label>
                  <select 
                    value={settlementForm.payeeId}
                    onChange={(e) => setSettlementForm(prev => ({ ...prev, payeeId: e.target.value }))}
                  >
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.username}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Amount Paid</label>
                  <input 
                    type="number" 
                    step="0.01"
                    required
                    placeholder="0.00"
                    value={settlementForm.amount}
                    onChange={(e) => setSettlementForm(prev => ({ ...prev, amount: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Currency</label>
                  <select 
                    value={settlementForm.currency}
                    onChange={(e) => setSettlementForm(prev => ({ ...prev, currency: e.target.value }))}
                  >
                    <option value="INR">INR (₹)</option>
                    <option value="USD">USD ($)</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Date of Payment</label>
                <input 
                  type="date" 
                  required
                  value={settlementForm.settlementDate}
                  onChange={(e) => setSettlementForm(prev => ({ ...prev, settlementDate: e.target.value }))}
                />
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}>
                Record Payment
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
