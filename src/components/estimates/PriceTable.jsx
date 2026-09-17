import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Star } from "lucide-react";
import { useState } from "react";
import { EMAIL_VENDOR_MAP, WEB_PRINT_TYPES, WEB_VENDORS, applyMarkup } from "@/lib/constants";
import { usePricingRules, markupRateFor } from "@/lib/pricing";
import VendorQuoteFileImporter from "@/components/estimates/VendorQuoteFileImporter";

export default function PriceTable({ estimate, onUpdate }) {
  const [newVendor, setNewVendor] = useState({ vendor_name: "", price: "", delivery_date: "", notes: "" });

  const vendorPrices = estimate.vendor_prices || [];
  const printType = estimate.print_type;
  const { rules } = usePricingRules();
  const markupRate = markupRateFor(rules, printType);

  // Get suggested vendors
  const emailVendors = EMAIL_VENDOR_MAP[printType] || [];
  const isWebType = WEB_PRINT_TYPES.includes(printType);

  const addVendorPrice = () => {
    if (!newVendor.vendor_name || !newVendor.price) return;
    const updated = [...vendorPrices, { ...newVendor, price: Number(newVendor.price), is_selected: false }];
    onUpdate({ vendor_prices: updated });
    setNewVendor({ vendor_name: "", price: "", delivery_date: "", notes: "" });
  };

  const removeVendor = (idx) => {
    const updated = vendorPrices.filter((_, i) => i !== idx);
    onUpdate({ vendor_prices: updated });
  };

  const selectVendor = (idx) => {
    const updated = vendorPrices.map((v, i) => ({ ...v, is_selected: i === idx }));
    const selected = updated[idx];
    const costPrice = selected.price;
    const sellingPrice = applyMarkup(costPrice, markupRate);
    const grossProfit = sellingPrice - costPrice;

    onUpdate({
      vendor_prices: updated,
      selected_vendor: selected.vendor_name,
      cost_price: costPrice,
      selling_price: sellingPrice,
      gross_profit: grossProfit,
      markup_rate: markupRate,
    });
  };

  const autoSelectCheapest = () => {
    if (vendorPrices.length === 0) return;
    const minIdx = vendorPrices.reduce((min, v, i) => v.price < vendorPrices[min].price ? i : min, 0);
    selectVendor(minIdx);
  };

  const minPrice = vendorPrices.length > 0 ? Math.min(...vendorPrices.map(v => v.price)) : null;

  const addSuggestedVendor = (name) => {
    if (vendorPrices.some(v => v.vendor_name === name)) return;
    const updated = [...vendorPrices, { vendor_name: name, price: 0, delivery_date: "", notes: "", is_selected: false }];
    onUpdate({ vendor_prices: updated });
  };

  const updateVendorField = (idx, field, value) => {
    const updated = vendorPrices.map((v, i) => i === idx ? { ...v, [field]: field === "price" ? Number(value) : value } : v);
    onUpdate({ vendor_prices: updated });
  };

  const handleVendorPricesImported = (newVendorPrices) => {
    onUpdate({ vendor_prices: newVendorPrices });
  };

  return (
    <div className="space-y-4">
    <VendorQuoteFileImporter estimate={estimate} onImported={handleVendorPricesImported} />
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">各社見積価格</CardTitle>
          {vendorPrices.length > 0 && (
            <Button variant="outline" size="sm" onClick={autoSelectCheapest} className="gap-1.5 text-xs">
              <Star className="w-3.5 h-3.5" /> 最安値を自動選択
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Suggested vendors */}
        {(emailVendors.length > 0 || isWebType) && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">推奨見積依頼先（クリックで追加）:</p>
            <div className="flex flex-wrap gap-1.5">
              {emailVendors.map(name => (
                <Button
                  key={name}
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  disabled={vendorPrices.some(v => v.vendor_name === name)}
                  onClick={() => addSuggestedVendor(name)}
                >
                  {name}
                </Button>
              ))}
              {isWebType && WEB_VENDORS.map(name => (
                <Button
                  key={name}
                  variant="outline"
                  size="sm"
                  className="text-xs h-7 border-primary/30 text-primary"
                  disabled={vendorPrices.some(v => v.vendor_name === name)}
                  onClick={() => addSuggestedVendor(name)}
                >
                  {name}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Price table */}
        {vendorPrices.length > 0 && (
          <div className="rounded-lg border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-xs w-10"></TableHead>
                  <TableHead className="text-xs">会社名</TableHead>
                  <TableHead className="text-xs text-right">見積価格</TableHead>
                  <TableHead className="text-xs">納期</TableHead>
                  <TableHead className="text-xs">備考</TableHead>
                  <TableHead className="text-xs w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendorPrices.map((v, i) => (
                  <TableRow
                    key={i}
                    className={`${v.is_selected ? "bg-primary/5 border-l-2 border-l-primary" : ""} ${v.price === minPrice && v.price > 0 ? "" : ""}`}
                  >
                    <TableCell className="text-center">
                      <button
                        onClick={() => selectVendor(i)}
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                          v.is_selected ? "border-primary bg-primary" : "border-muted-foreground/30 hover:border-primary"
                        }`}
                      >
                        {v.is_selected && <Star className="w-3 h-3 text-primary-foreground fill-current" />}
                      </button>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-medium">{v.vendor_name}</span>
                      {v.price === minPrice && v.price > 0 && (
                        <Badge className="ml-1.5 text-[9px] bg-emerald-100 text-emerald-700 px-1 py-0">最安</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={v.price || ""}
                        onChange={e => updateVendorField(i, "price", e.target.value)}
                        className="w-28 text-right text-sm h-8"
                        placeholder="0"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="date"
                        value={v.delivery_date || ""}
                        onChange={e => updateVendorField(i, "delivery_date", e.target.value)}
                        className="w-36 text-sm h-8"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={v.notes || ""}
                        onChange={e => updateVendorField(i, "notes", e.target.value)}
                        className="text-sm h-8"
                        placeholder="備考"
                      />
                    </TableCell>
                    <TableCell>
                      <button onClick={() => removeVendor(i)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Add new vendor */}
        <div className="flex flex-wrap gap-2 items-end">
          <div className="space-y-1">
            <Label className="text-[10px]">会社名</Label>
            <Input
              value={newVendor.vendor_name}
              onChange={e => setNewVendor({ ...newVendor, vendor_name: e.target.value })}
              className="w-40 h-8 text-sm"
              placeholder="会社名"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">価格</Label>
            <Input
              type="number"
              value={newVendor.price}
              onChange={e => setNewVendor({ ...newVendor, price: e.target.value })}
              className="w-28 h-8 text-sm"
              placeholder="0"
            />
          </div>
          <Button variant="outline" size="sm" onClick={addVendorPrice} className="gap-1 h-8">
            <Plus className="w-3.5 h-3.5" /> 追加
          </Button>
        </div>
      </CardContent>
    </Card>
    </div>
  );
}
