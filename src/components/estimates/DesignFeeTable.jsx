import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Palette, Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { useDesignFeeMaster } from "@/lib/designFees";
import NumericField from "@/components/estimates/NumericField";

export default function DesignFeeTable({ estimate, onUpdate }) {
  const designFees = estimate.design_fees || [];
  const [selectedCategory, setSelectedCategory] = useState("");
  const [expandedCategories, setExpandedCategories] = useState({});
  const { groups: designFeeGroups } = useDesignFeeMaster();
  const DESIGN_CATEGORIES = designFeeGroups.map((g) => g.category);
  const getDesignItemsByCategory = (category) => designFeeGroups.find((g) => g.category === category)?.items || [];

  const totalDesignFee = designFees.reduce((sum, item) => sum + (item.selling_price || 0) * (item.quantity || 1), 0);

  const addItem = (masterItem) => {
    const newItem = {
      id: Date.now().toString(),
      category: selectedCategory,
      name: masterItem.name,
      detail: masterItem.detail,
      hours: masterItem.hours,
      selling_price: masterItem.selling_price,
      quantity: 1,
    };
    const updated = [...designFees, newItem];
    onUpdate({ design_fees: updated, design_fee_total: calcTotal(updated) });
  };

  const updateItem = (id, field, value) => {
    const updated = designFees.map(item =>
      item.id === id ? { ...item, [field]: value } : item
    );
    onUpdate({ design_fees: updated, design_fee_total: calcTotal(updated) });
  };

  const removeItem = (id) => {
    const updated = designFees.filter(item => item.id !== id);
    onUpdate({ design_fees: updated, design_fee_total: calcTotal(updated) });
  };

  const calcTotal = (items) =>
    items.reduce((sum, item) => sum + (item.selling_price || 0) * (item.quantity || 1), 0);

  const toggleCategory = (cat) => {
    setExpandedCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  // Group selected items by category for display
  const groupedByCategory = designFees.reduce((acc, item) => {
    const cat = item.category || "その他";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Palette className="w-4 h-4" /> デザイン費
          </CardTitle>
          {totalDesignFee > 0 && (
            <span className="text-sm font-bold text-primary">
              合計: ¥{totalDesignFee.toLocaleString()}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add item UI */}
        <div className="flex gap-2">
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="text-sm flex-1">
              <SelectValue placeholder="カテゴリーを選択..." />
            </SelectTrigger>
            <SelectContent>
              {DESIGN_CATEGORIES.map(cat => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Item list from selected category */}
        {selectedCategory && (
          <div className="border rounded-lg overflow-hidden">
            <div
              className="flex items-center justify-between px-3 py-2 bg-muted/40 cursor-pointer text-sm font-medium"
              onClick={() => toggleCategory(selectedCategory)}
            >
              <span>{selectedCategory}</span>
              {expandedCategories[selectedCategory] !== false ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
            {expandedCategories[selectedCategory] !== false && (
              <div className="divide-y">
                {getDesignItemsByCategory(selectedCategory).map((masterItem, idx) => (
                  <div key={idx} className="flex items-center justify-between px-3 py-2.5 hover:bg-muted/20 text-sm">
                    <div className="flex-1 min-w-0 mr-3">
                      <p className="text-sm leading-tight">{masterItem.name}</p>
                      {masterItem.detail && (
                        <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{masterItem.detail}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-medium text-primary whitespace-nowrap">
                        ¥{masterItem.selling_price.toLocaleString()}
                      </span>
                      {masterItem.hours && (
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {masterItem.hours}h
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={() => addItem(masterItem)}
                      >
                        <Plus className="w-3 h-3" /> 追加
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Selected items */}
        {designFees.length > 0 && (
          <div className="space-y-2 mt-2">
            <p className="text-xs font-medium text-muted-foreground">選択済みデザイン費項目</p>
            <div className="border rounded-lg divide-y">
              {Object.entries(groupedByCategory).map(([cat, items]) => (
                <div key={cat}>
                  <div className="px-3 py-1.5 bg-muted/20 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                    {cat}
                  </div>
                  {items.map(item => (
                    <div key={item.id} className="flex items-center gap-2 px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-tight">{item.name}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-muted-foreground">数量</span>
                          <NumericField
                            value={item.quantity || 1}
                            onCommit={(q) => updateItem(item.id, "quantity", q)}
                            className="h-7 w-14 text-xs text-center"
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">×</span>
                        <NumericField
                          value={item.selling_price || null}
                          onCommit={(p) => updateItem(item.id, "selling_price", p)}
                          className="h-7 w-24 text-xs text-right"
                        />
                        <span className="text-sm font-semibold text-primary w-24 text-right">
                          ¥{((item.selling_price || 0) * (item.quantity || 1)).toLocaleString()}
                        </span>
                        <button onClick={() => removeItem(item.id)} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="flex justify-end pt-1">
              <div className="text-sm font-bold bg-primary/10 text-primary rounded-lg px-4 py-2">
                デザイン費合計: ¥{totalDesignFee.toLocaleString()}
              </div>
            </div>
          </div>
        )}

        {designFees.length === 0 && !selectedCategory && (
          <p className="text-xs text-muted-foreground text-center py-4">
            上のカテゴリーからデザイン費項目を追加してください
          </p>
        )}
      </CardContent>
    </Card>
  );
}
