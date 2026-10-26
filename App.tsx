
import { useMemo, useState } from "react";
import "./App.css";
import flow from './assets/flow.png';

const API_URL = "http://localhost:3001/api/orders";

type OrderStatus = "ready" | "warning" | "blocked";

interface Order {
  rowNumber: number;
  po_number: string;
  customer_item_code: string;
  quantity: number;
  price: number;
  status: string;
  errors: string[];
}

interface Summary {
  total: number;
  ready: number;
  warning: number;
  blocked: number;
}

interface UploadResponse {
  message: string;
  orders: Order[];
  summary: Summary;
}

interface SubmitResponse {
  message: string;
  orders: Order[];
  total: number;
}

type ColumnKey =
    | "po_number"
    | "customer_item_code"
    | "quantity"
    | "price"
    | "status"
    | "errors";

type SortDirection = "asc" | "desc";

interface SortConfig {
  key: ColumnKey;
  direction: SortDirection;
}

const emptySummary: Summary = {
  total: 0,
  ready: 0,
  warning: 0,
  blocked: 0,
};

const statusOptions = ["all", "ready", "warning", "blocked", "submitted"];

function isEligible(order: Order): boolean {
  return (
      (order.status === "ready" || order.status === "warning")
  );
}

function calculateSummary(orders: Order[]): Summary {
  return {
    total: orders.length,
    ready: orders.filter((order) => order.status === "ready").length,
    warning: orders.filter((order) => order.status === "warning").length,
    blocked: orders.filter((order) => order.status === "blocked").length,
  };
}

function getCellValue(order: Order, key: ColumnKey): string | number {
  switch (key) {
    case "po_number":
      return order.po_number;
    case "customer_item_code":
      return order.customer_item_code;
    case "quantity":
      return order.quantity;
    case "price":
      return order.price;
    case "status":
      return order.status;
    case "errors":
      return order.errors.join(" ");
  }
}

function App() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());

  const [file, setFile] = useState<File | null>(null);
  const [loadingUpload, setLoadingUpload] = useState(false);
  const [loadingSubmit, setLoadingSubmit] = useState(false);

  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const [sortConfig, setSortConfig] = useState<SortConfig>({
    key: "po_number",
    direction: "asc",
  });

  const [filters, setFilters] = useState<Record<ColumnKey, string>>({
    po_number: "",
    customer_item_code: "",
    quantity: "",
    price: "",
    status: "all",
    errors: "",
  });

  // Filter first, then sort the displayed orders.
  const displayedOrders = useMemo(() => {
    const filtered = orders.filter((order) => {
      const matchesText = (
          key: ColumnKey,
          filterValue: string
      ): boolean => {
        if (!filterValue.trim()) return true;

        return String(getCellValue(order, key))
            .toLowerCase()
            .includes(filterValue.trim().toLowerCase());
      };

      const matchesStatus =
          filters.status === "all" ||
          order.status.toLowerCase() === filters.status.toLowerCase();

      return (
          matchesText("po_number", filters.po_number) &&
          matchesText("customer_item_code", filters.customer_item_code) &&
          matchesText("quantity", filters.quantity) &&
          matchesText("price", filters.price) &&
          matchesText("errors", filters.errors) &&
          matchesStatus
      );
    });

    return [...filtered].sort((a, b) => {
      const first = getCellValue(a, sortConfig.key);
      const second = getCellValue(b, sortConfig.key);

      let comparison: number;

      if (typeof first === "number" && typeof second === "number") {
        comparison = first - second;
      } else {
        comparison = String(first).localeCompare(String(second), undefined, {
          numeric: true,
          sensitivity: "base",
        });
      }

      return sortConfig.direction === "asc" ? comparison : -comparison;
    });
  }, [orders, filters, sortConfig]);

  const visibleEligibleOrders = displayedOrders.filter(isEligible);

  const allVisibleEligibleSelected =
      visibleEligibleOrders.length > 0 &&
      visibleEligibleOrders.every((order) =>
          selectedRows.has(order.rowNumber)
      );

  function handleFilterChange(key: ColumnKey, value: string) {
    setFilters((previous) => ({
      ...previous,
      [key]: value,
    }));
  }

  function handleSort(key: ColumnKey) {
    setSortConfig((previous) => ({
      key,
      direction:
          previous.key === key && previous.direction === "asc"
              ? "desc"
              : "asc",
    }));
  }

  function sortIndicator(key: ColumnKey) {
    if (sortConfig.key !== key) return "↕";
    return sortConfig.direction === "asc" ? "▲" : "▼";
  }

  function toggleRow(rowNumber: number, checked: boolean) {
    setSelectedRows((previous) => {
      const next = new Set(previous);

      if (checked) {
        next.add(rowNumber);
      } else {
        next.delete(rowNumber);
      }

      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    setSelectedRows((previous) => {
      const next = new Set(previous);

      // Select or deselect eligible rows in the current filtered view only.
      visibleEligibleOrders.forEach((order) => {
        if (checked) {
          next.add(order.rowNumber);
        } else {
          next.delete(order.rowNumber);
        }
      });

      return next;
    });
  }

  async function handleUpload() {
    if (!file) {
      setErrorMessage("Please select a CSV file first.");
      setMessage("");
      return;
    }

    setLoadingUpload(true);
    setErrorMessage("");
    setMessage("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`${API_URL}/upload`, {
        method: "POST",
        body: formData,
      });

      const data = (await response.json()) as UploadResponse & {
        message?: string;
      };

      if (!response.ok) {
        throw new Error(data.message || "Unable to process the CSV file.");
      }

      setOrders(data.orders);
      setSummary(data.summary ?? calculateSummary(data.orders));
      setSelectedRows(new Set());
      setMessage(data.message || "CSV uploaded successfully.");
      setFile(null);

      // Reset the file input after a successful upload.
      const input = document.getElementById(
          "csv-file-input"
      ) as HTMLInputElement | null;

      if (input) input.value = "";
    } catch (error: unknown) {
      setErrorMessage(
          error instanceof Error ? error.message : "An unexpected error occurred."
      );
    } finally {
      setLoadingUpload(false);
    }
  }

  // Change selected eligible orders to ready in the frontend.
  function approveSelected() {
    const selectedEligible = orders.filter(
        (order) => selectedRows.has(order.rowNumber) && isEligible(order)
    );

    if (selectedEligible.length === 0) {
      setErrorMessage("Select at least one eligible order to approve.");
      setMessage("");
      return;
    }

    const approvedRowNumbers = new Set(
        selectedEligible.map((order) => order.rowNumber)
    );

    const nextOrders = orders.map((order) =>
        approvedRowNumbers.has(order.rowNumber)
            ? { ...order, status: "ready" }
            : order
    );

    setOrders(nextOrders);
    setSummary(calculateSummary(nextOrders));
    setSelectedRows((previous) => {
      const next = new Set(previous);
      approvedRowNumbers.forEach((rowNumber) => next.delete(rowNumber));
      return next;
    });

    setErrorMessage("");
    setMessage(`${selectedEligible.length} order(s) marked ready.`);
  }

  async function submitSelected() {
    const chosen = orders.filter(
        (order) => selectedRows.has(order.rowNumber) && isEligible(order)
    );

    if (chosen.length === 0) {
      setErrorMessage("Select at least one eligible order to submit.");
      setMessage("");
      return;
    }

    setLoadingSubmit(true);
    setErrorMessage("");
    setMessage("");

    try {
      const response = await fetch(`${API_URL}/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        // Send every field of each selected order as JSON.
        body: JSON.stringify({ orders: chosen }),
      });

      const data = (await response.json()) as SubmitResponse & {
        message?: string;
      };

      if (!response.ok) {
        throw new Error(data.message || "Failed to submit orders.");
      }

      if (!Array.isArray(data.orders)) {
        throw new Error("The server response did not contain updated orders.");
      }

      // Use the complete order data returned by the backend.
      const updatedByRow = new Map(
          data.orders.map((order) => [order.rowNumber, order])
      );

      const nextOrders = orders.map(
          (order) => updatedByRow.get(order.rowNumber) ?? order
      );

      setOrders(nextOrders);
      setSummary(calculateSummary(nextOrders));

      // Remove submitted rows from the selection.
      setSelectedRows((previous) => {
        const next = new Set(previous);
        data.orders.forEach((order) => next.delete(order.rowNumber));
        return next;
      });

      setMessage(data.message || "Orders submitted successfully.");
    } catch (error: unknown) {
      setErrorMessage(
          error instanceof Error ? error.message : "An unexpected error occurred."
      );
    } finally {
      setLoadingSubmit(false);
    }
  }

  function clearFilters() {
    setFilters({
      po_number: "",
      customer_item_code: "",
      quantity: "",
      price: "",
      status: "all",
      errors: "",
    });
  }

  function renderTextFilter(
      key: ColumnKey,
      placeholder: string
  ) {
    return (
        <input
            className="column-filter"
            type="text"
            value={filters[key]}
            placeholder={placeholder}
            onChange={(event) => handleFilterChange(key, event.target.value)}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Filter ${key}`}
        />
    );
  }

  return (
      <main className="app-container">
        <header className="app-header">
          <h1>Purchase Order Review</h1>
          <p>Upload, review, approve, and submit purchase orders.</p>
        </header>

        <section className="upload-section">
          <h2>Upload CSV</h2>

          <div className="upload-controls">
            <input
                id="csv-file-input"
                type="file"
                accept=".csv,text/csv"
                onChange={(event) =>
                    setFile(event.target.files?.[0] ?? null)
                }
            />

            <button
                type="button"
                onClick={handleUpload}
                disabled={loadingUpload || !file}
            >
              {loadingUpload ? "Processing..." : "Upload CSV"}
            </button>
          </div>

          <p className="help-text">
            Required columns: po_number, customer_item_code, quantity, price,
            status.
          </p>
        </section>

        {errorMessage && (
            <div className="alert alert-error" role="alert">
              {errorMessage}
            </div>
        )}

        {message && (
            <div className="alert alert-success" role="status">
              {message}
            </div>
        )}

        <section className="summary-section">
          <h2>Order Summary</h2>

          <div className="summary-cards">
            <div className="summary-card">
              <span>Total Orders</span>
              <strong>{summary.total}</strong>
            </div>

            <div className="summary-card summary-ready">
              <span>Ready</span>
              <strong>{summary.ready}</strong>
            </div>

            <div className="summary-card summary-warning">
              <span>Warning</span>
              <strong>{summary.warning}</strong>
            </div>

            <div className="summary-card summary-blocked">
              <span>Blocked</span>
              <strong>{summary.blocked}</strong>
            </div>
          </div>
        </section>

        <section className="orders-section">
          <div className="table-toolbar">
            <div>
              <h2>Orders</h2>
              <p>
                Showing {displayedOrders.length} of {orders.length} orders.
                {" "}Selected: {selectedRows.size}
              </p>
            </div>

            <div className="table-actions">
            {/*  <button*/}
            {/*      type="button"*/}
            {/*      onClick={approveSelected}*/}
            {/*      disabled={*/}
            {/*          loadingSubmit ||*/}
            {/*          !orders.some(*/}
            {/*              (order) =>*/}
            {/*                  selectedRows.has(order.rowNumber) && isEligible(order)*/}
            {/*          )*/}
            {/*      }*/}
            {/*  >*/}
            {/*    Approve All Selected*/}
            {/*  </button>*/}

              <button
                  type="button"
                  onClick={submitSelected}
                  disabled={loadingSubmit || loadingUpload}
              >
                {loadingSubmit ? "Submitting..." : "Submit Selected"}
              </button>

              <button
                  type="button"
                  className="secondary-button"
                  onClick={clearFilters}
              >
                Clear Filters
              </button>
            </div>
          </div>

          <div className="table-wrapper">
            <table className="orders-table">
              <thead>
              <tr>
                <th className="checkbox-column">
                  <input
                      type="checkbox"
                      checked={allVisibleEligibleSelected}
                      disabled={visibleEligibleOrders.length === 0}
                      onChange={(event) =>
                          toggleSelectAll(event.target.checked)
                      }
                      aria-label="Select all visible eligible orders"
                      title="Select all visible eligible orders"
                  />
                </th>

                <th>
                  <button
                      type="button"
                      className="sort-button"
                      onClick={() => handleSort("po_number")}
                  >
                    PO Number {sortIndicator("po_number")}
                  </button>
                  {renderTextFilter("po_number", "Filter PO")}
                </th>

                <th>
                  <button
                      type="button"
                      className="sort-button"
                      onClick={() => handleSort("customer_item_code")}
                  >
                    Customer Item Code {sortIndicator("customer_item_code")}
                  </button>
                  {renderTextFilter("customer_item_code", "Filter item code")}
                </th>

                <th>
                  <button
                      type="button"
                      className="sort-button"
                      onClick={() => handleSort("quantity")}
                  >
                    Quantity {sortIndicator("quantity")}
                  </button>
                  {renderTextFilter("quantity", "Filter quantity")}
                </th>

                <th>
                  <button
                      type="button"
                      className="sort-button"
                      onClick={() => handleSort("price")}
                  >
                    Price {sortIndicator("price")}
                  </button>
                  {renderTextFilter("price", "Filter price")}
                </th>

                <th>
                  <button
                      type="button"
                      className="sort-button"
                      onClick={() => handleSort("status")}
                  >
                    Status {sortIndicator("status")}
                  </button>

                  <select
                      className="column-filter"
                      value={filters.status}
                      onChange={(event) =>
                          handleFilterChange("status", event.target.value)
                      }
                      aria-label="Filter by status"
                  >
                    {statusOptions.map((status) => (
                        <option key={status} value={status}>
                          {status === "all"
                              ? "All statuses"
                              : status.charAt(0).toUpperCase() + status.slice(1)}
                        </option>
                    ))}
                  </select>
                </th>

                <th>
                  <button
                      type="button"
                      className="sort-button"
                      onClick={() => handleSort("errors")}
                  >
                    Validation {sortIndicator("errors")}
                  </button>
                  {renderTextFilter("errors", "Filter errors")}
                </th>
              </tr>
              </thead>

              <tbody>
              {displayedOrders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="empty-state">
                      {orders.length === 0
                          ? "Upload a CSV file to display orders."
                          : "No orders match the current filters."}
                    </td>
                  </tr>
              ) : (
                  displayedOrders.map((order) => (
                      <tr
                          key={order.rowNumber}
                          className={`status-row status-${order.status.toLowerCase()}`}
                      >
                        <td className="checkbox-column">
                          {["ready", "warning"].includes(order.status) &&
                          <input
                              type="checkbox"
                              checked={selectedRows.has(order.rowNumber)}
                              disabled={!isEligible(order) || loadingSubmit}
                              onChange={(event) =>
                                  toggleRow(order.rowNumber, event.target.checked)
                              }
                              aria-label={`Select order ${order.po_number}`}
                              title={
                                isEligible(order)
                                    ? "Select order"
                                    : "Only valid ready or warning orders can be selected"
                              }
                          />}
                        </td>

                        <td>{order.po_number}</td>
                        <td>{order.customer_item_code}</td>
                        <td>{order.quantity}</td>
                        <td>
                          {Number.isFinite(order.price)
                              ? order.price.toFixed(2)
                              : order.price}
                        </td>
                        <td>
                      <span
                          className={`status-badge status-badge-${order.status.toLowerCase()}`}
                      >
                        {order.status}
                      </span>
                        </td>
                        <td>
                          {order.errors.length > 0 ? (
                              <ul className="validation-errors">
                                {order.errors.map((error, index) => (
                                    <li key={`${order.rowNumber}-${index}`}>
                                      {error}
                                    </li>
                                ))}
                              </ul>
                          ) : (
                              <span className="no-errors">Valid</span>
                          )}
                        </td>
                      </tr>
                  ))
              )}
              </tbody>
            </table>
          </div>
          <div className="table-wrapper">
              <img src={flow} alt="Company Logo" width={1800} />
          </div>
          <div className="table-scroll">
            <h1>Assumptions</h1>
            <table>
              <ol className="q">
                <li>This can be used as a customer facing new order system with additional validation. Just need to add edit capabilities.</li>
                <li>I <b>assume</b> the purchase order are created with pre-negotiated pricing, and they have some what of discretionary on pricing!</li>
                <li>I assume we can not just use the sku instead of the customer_item_code for some reason?? Can We? or is it a formality because we are selling it different price??</li>
                <li>Why was the initial PO are enter into spreadsheets and not some order system that pre-validate the order in the first place??</li>
              </ol>
            </table>

            <table>
              <h1>Questions</h1>
              <ol className="q">
                <li>Merged "customer item cross-reference" table with "account price list" table for easier lookup, since these table are map 1to1. There is no technical reason why those 2 table could not be merged?</li>
                <li>Would like to make the price optional, when price is not specify, use the default price in price list. Less entry mean less error prone?</li>
                <li>Can We make the PO quantity as case unit rather than quantity unit since we are selling it by the case? If we allow item to be sold in a out of the case single unit why not just price the it at a single unit?</li>
                <li>We need to decide how much price different is acceptable with the business. Currently is at 5% different</li>
              </ol>
            </table>
          </div>

        </section>
      </main>
  );
}

export default App;
