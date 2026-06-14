'use client';

import { useState, useEffect } from 'react';

interface Customer {
  id: string;
  email: string;
  phone: string;
  name: string;
  totalSpend: number;
  orderCount: number;
  lastOrderDate: string;
  avgOrderValue: number;
  properties: {
    city: string;
    preferredCategories: string[];
    platform: string;
    segment: string;
    loyaltyTier: string;
    hasApp: boolean;
    acceptsMarketing: boolean;
    preferredChannel: string;
    lastBrowseDate: string;
    cartAbandoned: boolean;
    referralSource: string;
    ageGroup: string;
    gender: string;
  };
  createdAt: string;
}

interface Order {
  id: string;
  orderId: string;
  customerEmail: string;
  amount: number;
  orderDate: string;
  items: Array<{ name: string; quantity: number; price: number }>;
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [segmentFilter, setSegmentFilter] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedCustomerDetails, setSelectedCustomerDetails] = useState<{
    customer: Customer;
    orders: Order[];
    communicationHistory?: Array<{
      messageId: string;
      campaignId: string;
      campaignName: string;
      channel: string;
      status: string;
      sentAt?: string;
      deliveredAt?: string;
      openedAt?: string;
      clickedAt?: string;
    }>;
    engagementMetrics?: {
      totalMessages: number;
      delivered: number;
      opened: number;
      clicked: number;
      preferredChannel: string;
      lastEngagementAt: string | null;
    };
  } | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const fetchCustomers = async (segment = segmentFilter) => {
    setLoading(true);
    try {
      // Artificial delay for production feel
      await new Promise((resolve) => setTimeout(resolve, 800));
      
      let url = '/api/customers?limit=100';
      if (segment) {
        url += `&segment=${segment}`;
      }
      const res = await fetch(url);
      const data = await res.json();
      setCustomers(data.customers || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCustomerDetails = async (id: string) => {
    setDetailsLoading(true);
    try {
      const res = await fetch(`/api/customers?id=${id}`);
      const data = await res.json();
      if (data.customer) {
        setSelectedCustomerDetails(data);
      } else {
        console.error('Customer not found', data);
        setSelectedCustomerDetails(null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDetailsLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCustomers(segmentFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentFilter]);

  const handleCustomerClick = (cId: string) => {
    if (selectedCustomerId === cId) {
      setSelectedCustomerId(null);
      setSelectedCustomerDetails(null);
    } else {
      setSelectedCustomerId(cId);
      fetchCustomerDetails(cId);
    }
  };

  const filteredCustomers = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.email.toLowerCase().includes(search.toLowerCase()) ||
      c.properties.city.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ padding: 'var(--space-6) var(--space-5)', display: 'flex', flexDirection: 'column', gap: '20px', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-primary)' }}>Shoppers</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Ingested profiles and historical customer retention attributes.</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search shoppers by name, email, or city..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-field"
          style={{ maxWidth: '320px', minHeight: '36px' }}
        />
        <select
          value={segmentFilter}
          onChange={(e) => setSegmentFilter(e.target.value)}
          className="input-field"
          style={{ maxWidth: '180px', minHeight: '36px', padding: '0 var(--space-3)' }}
        >
          <option value="">All Segments</option>
          <option value="champion">Champions</option>
          <option value="high_value">High Value</option>
          <option value="regular">Regulars</option>
          <option value="new">New Shoppers</option>
          <option value="at_risk">At Risk</option>
          <option value="dormant">Dormant</option>
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedCustomerId ? '1fr 360px' : '1fr', gap: '20px', alignItems: 'start' }}>
        {/* Table list */}
        <div id="tour-customer-list" className="structured-card" style={{ overflowX: 'auto', border: '1px solid var(--border-default)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-default)', background: 'var(--bg-secondary)' }}>
                {['Name', 'City', 'Loyalty', 'Segment', 'Orders', 'Total Spend', 'Last Order'].map((h) => (
                  <th key={h} style={{ padding: '10px var(--space-4)', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 500, fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '12px var(--space-4)' }}>
                      <div className="skeleton skeleton-title" style={{ width: '60%', marginBottom: '6px' }} />
                      <div className="skeleton skeleton-text" style={{ width: '40%' }} />
                    </td>
                    <td style={{ padding: '12px var(--space-4)' }}><div className="skeleton skeleton-title" style={{ width: '80%' }} /></td>
                    <td style={{ padding: '12px var(--space-4)' }}><div className="skeleton skeleton-title" style={{ width: '50%' }} /></td>
                    <td style={{ padding: '12px var(--space-4)' }}><div className="skeleton skeleton-title" style={{ width: '70%' }} /></td>
                    <td style={{ padding: '12px var(--space-4)' }}><div className="skeleton skeleton-title" style={{ width: '30%' }} /></td>
                    <td style={{ padding: '12px var(--space-4)' }}><div className="skeleton skeleton-title" style={{ width: '50%' }} /></td>
                    <td style={{ padding: '12px var(--space-4)' }}><div className="skeleton skeleton-title" style={{ width: '40%' }} /></td>
                  </tr>
                ))
              ) : filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>No shoppers found.</td>
                </tr>
              ) : (
                filteredCustomers.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => handleCustomerClick(c.id)}
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                      background: selectedCustomerId === c.id ? 'var(--bg-elevated)' : 'transparent',
                    }}
                    className="customer-row"
                  >
                    <td style={{ padding: '12px var(--space-4)', fontWeight: 500, color: 'var(--text-primary)' }}>
                      <div>{c.name}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 400 }}>{c.email}</div>
                    </td>
                    <td style={{ padding: '12px var(--space-4)', color: 'var(--text-secondary)' }}>{c.properties.city}</td>
                    <td style={{ padding: '12px var(--space-4)', textTransform: 'capitalize' }}>
                      <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-xs)', fontWeight: 500 }} className={c.properties.loyaltyTier}>
                        {c.properties.loyaltyTier}
                      </span>
                    </td>
                    <td style={{ padding: '12px var(--space-4)', textTransform: 'capitalize' }}>
                      <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-xs)', fontWeight: 500 }} className={`segment-${c.properties.segment}`}>
                        {c.properties.segment.replace('_', ' ')}
                      </span>
                    </td>
                    <td style={{ padding: '12px var(--space-4)', fontFamily: 'var(--font-mono)' }}>{c.orderCount}</td>
                    <td style={{ padding: '12px var(--space-4)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                      ₹{c.totalSpend.toLocaleString('en-IN')}
                    </td>
                    <td style={{ padding: '12px var(--space-4)', color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
                      {new Date(c.lastOrderDate).toLocaleDateString('en-IN')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Detailed Drawer */}
        {selectedCustomerId && (
          <div className="structured-card" style={{ padding: 'var(--space-4)', border: '1px solid var(--border-emphasis)', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', gap: '16px', animation: 'fadeIn var(--duration-fast) var(--ease-out)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="card-type-label">Shopper Profile</span>
              <button onClick={() => { setSelectedCustomerId(null); setSelectedCustomerDetails(null); }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
            </div>

            {detailsLoading ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Loading profile details...</div>
            ) : selectedCustomerDetails ? (
              <>
                <div>
                  <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>{selectedCustomerDetails.customer.name}</h2>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>ID: {selectedCustomerDetails.customer.id.slice(0, 8)}</div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Phone</span>
                    <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{selectedCustomerDetails.customer.phone}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Channel Pref</span>
                    <span style={{ color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{selectedCustomerDetails.customer.properties.preferredChannel}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Accepts Marketing</span>
                    <span style={{ color: selectedCustomerDetails.customer.properties.acceptsMarketing ? 'var(--green)' : 'var(--red)' }}>
                      {selectedCustomerDetails.customer.properties.acceptsMarketing ? 'Yes' : 'No'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Age Group / Gender</span>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {selectedCustomerDetails.customer.properties.ageGroup} / {selectedCustomerDetails.customer.properties.gender}
                    </span>
                  </div>
                </div>

                <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '16px' }}>
                  <h3 style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
                    Engagement Metrics
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                    {[
                      ['Messages', selectedCustomerDetails.engagementMetrics?.totalMessages || 0],
                      ['Delivered', selectedCustomerDetails.engagementMetrics?.delivered || 0],
                      ['Opened', selectedCustomerDetails.engagementMetrics?.opened || 0],
                      ['Clicked', selectedCustomerDetails.engagementMetrics?.clicked || 0],
                    ].map(([label, value]) => (
                      <div key={label} style={{ padding: '8px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                        <div style={{ fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{value}</div>
                        <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: '8px', fontSize: '10px', color: 'var(--text-muted)' }}>
                    Last engagement: {selectedCustomerDetails.engagementMetrics?.lastEngagementAt ? new Date(selectedCustomerDetails.engagementMetrics.lastEngagementAt).toLocaleString('en-IN') : 'No live campaign touch yet'}
                  </div>
                </div>

                <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '16px' }}>
                  <h3 style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
                    Communication History
                  </h3>
                  {selectedCustomerDetails.communicationHistory && selectedCustomerDetails.communicationHistory.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                      {selectedCustomerDetails.communicationHistory.map((m) => (
                        <div key={m.messageId} style={{ padding: '8px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
                            <span style={{ fontSize: '11px', color: 'var(--text-primary)', fontWeight: 600 }}>{m.campaignName}</span>
                            <span className="evidence-chip" style={{ textTransform: 'uppercase' }}>{m.channel}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)' }}>
                            <span>Status: {m.status}</span>
                            <span>{m.deliveredAt ? new Date(m.deliveredAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'Queued'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
                      No communication events yet. Launch a campaign to populate this timeline.
                    </div>
                  )}
                </div>

                <div>
                  <h3 style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
                    Purchase History ({selectedCustomerDetails.orders.length} orders)
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto' }}>
                    {selectedCustomerDetails.orders.map((o) => (
                      <div key={o.id} style={{ padding: '10px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-primary)' }}>{o.orderId.slice(0, 10)}</span>
                          <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>₹{o.amount.toLocaleString('en-IN')}</span>
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                          {new Date(o.orderDate).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {o.items.map((item, idx) => (
                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
                              <span>{item.name} (x{item.quantity})</span>
                              <span>₹{item.price}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Failed to load profile.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
