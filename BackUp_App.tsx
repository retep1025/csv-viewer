
import { useState } from "react";
import "./App.css";

function formatCurrency(
    value: number,
    currency: string = 'USD',
    locale?: string
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency,
  }).format(value);
}


const idempotentKey = new Map<string, string>();

interface Item{
  sku: string;
  name: string;
  casePack: number;
  active: boolean;
}

const items: Item[] = [
  {sku: "sku-111", name: "Item-111", casePack: 12, active: true},
  {sku: "sku-222", name: "Item-222", casePack: 12, active: true},
  {sku: "sku-333", name: "Item-333", casePack: 12, active: true},
  {sku: "sku-444", name: "Item-444", casePack: 12, active: false},
  {sku: "sku-555", name: "Item-555", casePack: 12, active: true},
  {sku: "sku-666", name: "Item-666", casePack: 12, active: false},
  {sku: "sku-777", name: "Item-777", casePack: 12, active: true},
  {sku: "sku-888", name: "Item-888", casePack: 12, active: true},
]

const skuLookup = new Map<string, Item>();
for (const item of items) {
  skuLookup.set(item.sku, item);
}

interface CustomerTerm{
  accountId: string;
  customerItemCode: string;
  sku: string;
  casePrice: number;
  term: string;
}


const terms: CustomerTerm[] = [
  {accountId: "A100", customerItemCode: "MO-2", sku: "sku-111", casePrice: 10.00, term: "net 45"},
  {accountId: "A100", customerItemCode: "MO-3", sku: "sku-222", casePrice: 10.00, term: "net 45"},
  {accountId: "A100", customerItemCode: "MO-5", sku: "sku-333", casePrice: 24.00, term: "net 45"},
  {accountId: "A200", customerItemCode: "MO-7", sku: "sku-444", casePrice: 24.00, term: "net 45"},
  {accountId: "A200", customerItemCode: "MO-11", sku: "sku-888", casePrice: 24.00, term: "net 45"},
  {accountId: "A100", customerItemCode: "MO-13", sku: "sku-555", casePrice: 30.00, term: "net 30"},
  {accountId: "A100", customerItemCode: "MO-17", sku: "sku-666", casePrice: 30.00, term: "net 15"},
  {accountId: "A100", customerItemCode: "MO-19", sku: "sku-777", casePrice: 40.00, term: "net 60"},
]

const termLookup = new Map<string, CustomerTerm>();
for (const term of terms) {
  termLookup.set(term.customerItemCode, term);
}


type POStatus = "ready" | "warning" | "blocked";

interface PurchaseOrder {
  po_number: string;
  customer_item_code: string;
  quantity: number;
  adjusted_qty: number;
  price: number;
  status: POStatus;
  reason: string;
}

const REQUIRED_COLUMNS = [
  "po_number",
  "customer_item_code",
  "quantity",
  "price",
] as const;

// Parse CSV while supporting quoted values and escaped quotes.
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      values.push(value.trim());
      value = "";
    } else {
      value += char;
    }
  }

  if (inQuotes) {
    throw new Error("CSV contains an unclosed quoted field.");
  }

  values.push(value.trim());
  return values;
}

function parseCSV(text: string): PurchaseOrder[] {
  // Normalize line endings and remove a possible UTF-8 BOM.
  const lines = text
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .filter((line) => line.trim() !== "");

  if (lines.length < 2) {
    throw new Error("CSV must contain a header and at least one data row.");
  }

  const headers = parseCSVLine(lines[0]).map((header) =>
      header.trim().toLowerCase()
  );

  const missing = REQUIRED_COLUMNS.filter(
      (column) => !headers.includes(column)
  );

  if (missing.length > 0) {
    throw new Error(`Missing required columns: ${missing.join(", ")}`);
  }

  const indexes = Object.fromEntries(
      REQUIRED_COLUMNS.map((column) => [
        column,
        headers.indexOf(column),
      ])
  ) as Record<(typeof REQUIRED_COLUMNS)[number], number>;

  return lines.slice(1).map((line, index) => {
    const values = parseCSVLine(line);

    if (values.length !== headers.length) {
      throw new Error(
          `Row ${index + 2}: expected ${headers.length} columns, ` +
          `but found ${values.length}.`
      );
    }

    const quantityText = values[indexes.quantity];
    const priceText = values[indexes.price];
    const quantity = Number(quantityText);
    const price = Number(priceText);


    if (!quantityText || !Number.isFinite(quantity) || quantity < 0) {
      throw new Error(`Row ${index + 2}: invalid quantity.`);
    }


    if (
        !priceText ||
        !Number.isFinite(price) ||
        price < 0
    ) {
      throw new Error(`Row ${index + 2}: invalid price.`);
    }


    const po_item = {
      po_number: values[indexes.po_number],
      customer_item_code: values[indexes.customer_item_code],
      quantity,
      adjusted_qty: quantity,
      price,
      status: status as POStatus,
      reason: "",
    };

    po_item.status = "ready";
    po_item.reason = "";
    const term = termLookup.get(po_item.customer_item_code);
    //check Item to see if its active
    if(term === undefined){
      po_item.status = "blocked";
      po_item.reason = "Customer Item Code Not Found";
    } else {
      const item = skuLookup.get(term.sku);
      if(item?.active === false){
        po_item.status = "blocked";
        po_item.reason = "Item Not Active";
      }else {
        if(po_item.quantity < 1){
          po_item.status = "blocked";
          po_item.reason = `quantity ${po_item.quantity} in not valid`;
        }else {
          if (po_item.quantity % 12 != 0) {
            po_item.adjusted_qty = Math.ceil(po_item.quantity / 12) * 12;
            po_item.status = "warning";
            po_item.reason = `${po_item.quantity} not X of 12 changing quantity to ${po_item.adjusted_qty}|`;
          }

          //5% difference is ok
          const total_price: number = term.casePrice * (po_item.adjusted_qty / 12);
          console.log(`${total_price == po_item.price} => ${total_price} == ${po_item.price} `);
          if(total_price != po_item.price && (1.05 * total_price) >= po_item.price && po_item.price >= (0.95 * total_price)){
            po_item.status = "warning";
            po_item.reason += `PO ${formatCurrency(po_item.price)} is within 5% of ${formatCurrency(total_price)} ok`;
          }else if(total_price != po_item.price) {
            po_item.status = "blocked";
            po_item.reason += `PO ${formatCurrency(po_item.price)} is not within 5% of ${formatCurrency(total_price)}`;
          }

        }

      }

    }


    if(po_item.status === "ready"){
      po_item.reason = "OK";
    }

    const key: string = `${po_item.po_number}|${po_item.customer_item_code}`;
    if(idempotentKey.has(key) && (po_item.status === "ready" || po_item.status === "warning")){
      po_item.status = "blocked";
      po_item.reason = "duplicate PO";
      return po_item;
    } else {
      idempotentKey.set(key, key);
    }


    return po_item;

  });
}

function App() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleFileUpload(
      event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError("");
    setLoading(true);

    try {
      if (!file.name.toLowerCase().endsWith(".csv")) {
        throw new Error("Please select a .csv file.");
      }

      const text = await file.text();
      const data = parseCSV(text);

      setOrders(data);
      setFileName(file.name);
    } catch (err) {
      setOrders([]);
      setFileName("");
      setError(
          err instanceof Error ? err.message : "Unable to read CSV file."
      );
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  }

  const readyCount = orders.filter(
      (order) => order.status === "ready"
  ).length;

  const warningCount = orders.filter(
      (order) => order.status === "warning"
  ).length;

  const blockedCount = orders.filter(
      (order) => order.status === "blocked"
  ).length;

  return (
      <main className="page">
        <header className="page-header">
          <div>
            <p className="eyebrow">PURCHASE ORDER MANAGEMENT</p>
            <h1>Purchase Order CSV Viewer</h1>
            <p className="subtitle">
              Upload your CSV file to review purchase orders by status.
            </p>
          </div>
        </header>

        <section className="upload-panel">
          <div className="upload-icon" aria-hidden="true">
            ↑
          </div>

          <h2>Upload CSV File</h2>
          <p>Choose a CSV file with the required purchase order columns.</p>

          <label className="upload-button">
            {loading ? "Reading CSV..." : "Choose CSV File"}
            <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileUpload}
                disabled={loading}
            />
          </label>

          {fileName && (
              <p className="file-name">Loaded: {fileName}</p>
          )}

          {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
          )}

          <p className="required-columns">
            Required: po_number, customer_item_code, quantity, price
          </p>
        </section>

        <section className="summary-grid" aria-label="Order status totals">
          <div className="summary-card ready-card">
            <span>Ready</span>
            <strong>{readyCount}</strong>
          </div>

          <div className="summary-card warning-card">
            <span>Warning</span>
            <strong>{warningCount}</strong>
          </div>

          <div className="summary-card blocked-card">
            <span>Blocked</span>
            <strong>{blockedCount}</strong>
          </div>
        </section>

        <section className="table-panel">
          <div className="table-header">
            <div>
              <h2>Purchase Orders</h2>
              <p>{orders.length} records found</p>
            </div>
          </div>

          {orders.length === 0 ? (
              <div className="empty-state">
                <p>No purchase orders to display.</p>
                <span>Upload a CSV file to get started.</span>
              </div>
          ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                  <tr>
                    <th><button>Approve</button></th>
                    <th>PO Number</th>
                    <th>Cust Item Cd</th>
                    <th className="numeric">Quantity</th>
                    <th className="numeric">Adj Quanity</th>
                    <th className="numeric">Price</th>
                    <th>Status</th>
                  </tr>
                  </thead>

                  <tbody>
                  {orders.map((order, index) => (
                      <tr
                          key={`${order.po_number}-${index}`}
                          className={`status-${order.status}`}
                      >
                        <td>
                          {(order.status === "warning" || order.status === "ready") && <input
                                    type="checkbox"
                                    id="subscribe-checkbox"
                                    checked={true} // Controlled by state
                                />
                          }
                        </td>
                        <td>{order.po_number || "—"}</td>
                        <td>{order.customer_item_code} {skuLookup.get(termLookup.get(order.customer_item_code)?.sku)?.name} </td>
                        <td className="numeric">
                          {order.quantity.toLocaleString()}
                        </td>
                        <td className="numeric">
                          {order.adjusted_qty != order.quantity && <b>{order.adjusted_qty.toLocaleString()}</b>}
                        </td>
                        <td className="numeric">
                          {order.price.toLocaleString("en-US", {
                            style: "currency",
                            currency: "USD",
                          })}
                        </td>
                        <td>
                      <span className={`status-badge badge-${order.status}`}>
                        {order.reason}
                      </span>
                        </td>
                      </tr>
                  ))}
                  </tbody>
                </table>
              </div>
          )}
        </section>

      </main>
  );
}

export default App;
