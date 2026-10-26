
import express, { type Request, type Response } from "express";
import cors from "cors";
import multer from "multer";
import { parse } from "csv-parse/sync";

const app = express();
const PORT = 3001;

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json({ limit: "2mb" }));

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

let submited_counter = 0;

function idemKey(
    po_number: string,
    customer_item_code:string,
): string{
    return `${po_number}|${customer_item_code}`;
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






const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
});

const REQUIRED_COLUMNS = [
    "po_number",
    "customer_item_code",
    "quantity",
] as const;

const ALLOWED_STATUSES = ["ready", "warning", "blocked"] as const;

type OrderStatus = (typeof ALLOWED_STATUSES)[number];

interface OrderInput {
    po_number: string;
    customer_item_code: string;
    quantity: number | string;
    price: number | string;
    status: string;
}

interface Order extends OrderInput {
    rowNumber: number;
    status: OrderStatus | string;
    quantity: number;
    price: number;
    errors: string[];
}

interface Summary {
    total: number;
    ready: number;
    warning: number;
    blocked: number;
}

interface SubmitResult {
    po_number: string;
    success: boolean;
    message: string;
}

function validateOrder(
    row: Record<string, unknown>,
    index: number
): Order {
    const errors: string[] = [];

    const po_number = String(row.po_number ?? "").trim();
    let customer_item_code = String(
        row.customer_item_code ?? ""
    ).trim();

    const quantity = Number(row.quantity);
    let price = Number(row.price);


    if (!po_number) {
        errors.push("Missing PO number.");
    }

    if (!customer_item_code) {
        errors.push("Missing customer item code.");
    }

    if (
        row.quantity === undefined ||
        row.quantity === null ||
        String(row.quantity).trim() === "" ||
        !Number.isFinite(quantity) ||
        quantity <= 0
    ) {
        errors.push("Quantity must be greater than zero.");
    }

    const cic:string[] = customer_item_code.split("|");
    customer_item_code = cic[0].trim();

    const term = termLookup.get(customer_item_code);
    let status = "ready";
    const key = idemKey(po_number, customer_item_code);
    if(term === undefined){
        status = "blocked";
        errors.push("Customer Item Code Not Found");
    } else if(idempotentKey.has(key)) {
        status = "submitted";
        errors.push(`duplicate PO ${po_number} and ${customer_item_code}`);
    } else {
        customer_item_code += ` | ${term.sku}`;
        const item = skuLookup.get(term.sku);
        if(item?.active === false){
            status = "blocked";
            errors.push("Item Not Active");
        }else {
            if(quantity < 1){
                status = "blocked";
                errors.push(`quantity ${quantity} in not valid`);
            }else {
                if (row.price === undefined || row.price === null ||
                    String(row.price).trim() === "" ||
                    !Number.isFinite(price)){
                    price = term.casePrice * quantity;
                }else if(price < 0){
                    errors.push("Price must be zero or greater.");
                }

                //5% difference is ok
                const total_price: number = term.casePrice * quantity;
                if(total_price != price && (1.05 * total_price) >= price && price >= (0.95 * total_price)){
                    status = "warning";
                    errors.push(`PO ${formatCurrency(price)} is within 5% of ${formatCurrency(total_price)} ok`);
                }else if(total_price != price) {
                    status = "blocked";
                    errors.push(`PO ${formatCurrency(price)} is not within 5% of ${formatCurrency(total_price)}`);
                }

            }

        }

    }

    return {
        rowNumber: index,
        po_number,
        customer_item_code,
        quantity,
        price,
        status,
        errors,
    };
}

function summarize(orders: Order[]): Summary {
    return {
        total: orders.length,
        ready: orders.filter((order) => order.status === "ready").length,
        warning: orders.filter((order) => order.status === "warning").length,
        blocked: orders.filter((order) => order.status === "blocked").length,
    };
}

// POST /api/orders/upload
// Accepts a CSV file and returns validated orders plus status counts.
app.post(
    "/api/orders/upload",
    upload.single("file"),
    (req: Request, res: Response): void => {
        try {
            if (!req.file) {
                res.status(400).json({
                    message: "Please upload a CSV file.",
                });
                return;
            }

            const records = parse(req.file.buffer.toString("utf8"), {
                bom: true,
                columns: (headers: string[]) =>
                    headers.map((header) => header.trim()),
                skip_empty_lines: true,
                trim: true,
                relax_column_count: false,
            }) as Record<string, string>[];

            if (records.length === 0) {
                res.status(400).json({
                    message: "The CSV contains no data rows.",
                });
                return;
            }

            const actualHeaders = Object.keys(records[0]);

            const missing = REQUIRED_COLUMNS.filter(
                (column) => !actualHeaders.includes(column)
            );

            if (missing.length > 0) {
                res.status(400).json({
                    message: `Missing required CSV columns: ${missing.join(", ")}`,
                });
                return;
            }

            const orders: Order[] = records.map((record, index) =>
                validateOrder(record, index + 1)
            );

            res.json({
                message: "CSV processed successfully.",
                orders,
                summary: summarize(orders),
            });
        } catch (error: unknown) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Unknown CSV parsing error.";

            res.status(400).json({
                message: `Unable to parse CSV: ${message}`,
            });
        }
    }
);

// POST /api/orders/submit
// Processes selected ready/warning orders.
app.post(
    "/api/orders/submit",
    (req: Request, res: Response): void => {
        try {
            const body = req.body as { orders?: unknown };

            if (!Array.isArray(body.orders)) {
                res.status(400).json({
                    message: 'Invalid request. Expected { "orders": [...] }.',
                });
                return;
            }

            const updatedOrders: Order[] = body.orders.map(
                (item: unknown, index: number): Order => {
                    if (typeof item !== "object" || item === null) {
                        throw new Error(`Order at index ${index} is invalid.`);
                    }

                    const input = item as Record<string, unknown>;
                    const rowNumber =
                        Number.isInteger(input.rowNumber) &&
                        Number(input.rowNumber) > 0
                            ? Number(input.rowNumber)
                            : index + 1;
                    // Validate the complete order data received from React.
                    const order = validateOrder(input, rowNumber);
                    // Change valid ready/warning orders to blocked on submission.

                    if(submited_counter % 5 === 0) {
                        order.errors.push("Error while submit order to NewSuite. Please try again.");
                        submited_counter++;
                    }else if (order.status === "ready" || order.status === "warning") {
                        const cic: string[] = order.customer_item_code.split("|");
                        const customer_item_code:string = cic[0].trim();
                        const key = idemKey(order.po_number, customer_item_code);
                        if(idempotentKey.has(key)){
                            order.status = "submitted";
                            order.errors.push(`duplicated PO ${order.po_number} and ${customer_item_code}`);
                        } else {
                            idempotentKey.set(key, key);
                            order.status = "submitted";
                            submited_counter++;
                        }

                    }

                    return order;
                }
            );

            res.status(200).json({
                message: "Orders processed successfully.",
                orders: updatedOrders,
                total: updatedOrders.length,
            });
        } catch (error: unknown) {
            const message =
                error instanceof Error ? error.message : "Unknown server error.";

            res.status(400).json({ message });
        }
    }
);

app.listen(PORT, () => {
    console.log(`Order service running at http://localhost:${PORT}`);
});
