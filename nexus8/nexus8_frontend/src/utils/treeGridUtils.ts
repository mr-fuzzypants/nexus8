import * as XLSX from 'xlsx';
import type { KanbanCard } from '../schema';

/**
 * Export cards to CSV format
 */
export function exportToCSV(cards: KanbanCard[], filename: string = 'treegrid-export.csv'): void {
  if (cards.length === 0) {
    console.warn('No cards to export');
    return;
  }

  // Get all unique metadata keys
  const metadataKeys = new Set<string>();
  cards.forEach(card => {
    if (card.metadata) {
      Object.keys(card.metadata).forEach(key => metadataKeys.add(key));
    }
  });

  // Create headers
  const headers = [
    'ID',
    'Title',
    'Description',
    'Status',
    'Path',
    'Parent ID',
    ...Array.from(metadataKeys),
    'Created At',
    'Updated At',
  ];

  // Create rows
  const rows = cards.map(card => {
    const row: any[] = [
      card.id,
      card.title,
      card.description,
      card.status,
      card.path,
      card.parentId || '',
    ];

    // Add metadata values
    metadataKeys.forEach(key => {
      const value = card.metadata?.[key];
      if (Array.isArray(value)) {
        row.push(value.join(', '));
      } else if (value !== null && value !== undefined) {
        row.push(String(value));
      } else {
        row.push('');
      }
    });

    row.push(card.createdAt);
    row.push(card.updatedAt);

    return row;
  });

  // Combine headers and rows
  const csv = [
    headers.map(h => `"${h}"`).join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  // Download file
  downloadFile(csv, filename, 'text/csv');
}

/**
 * Export cards to Excel format with styling
 */
export function exportToExcel(cards: KanbanCard[], filename: string = 'treegrid-export.xlsx'): void {
  if (cards.length === 0) {
    console.warn('No cards to export');
    return;
  }

  // Get all unique metadata keys
  const metadataKeys = new Set<string>();
  cards.forEach(card => {
    if (card.metadata) {
      Object.keys(card.metadata).forEach(key => metadataKeys.add(key));
    }
  });

  // Create worksheet data
  const worksheetData: any[][] = [];

  // Headers
  const headers = [
    'ID',
    'Title',
    'Description',
    'Status',
    'Path',
    'Parent ID',
    ...Array.from(metadataKeys),
    'Created At',
    'Updated At',
  ];
  worksheetData.push(headers);

  // Data rows
  cards.forEach(card => {
    const row: any[] = [
      card.id,
      card.title,
      card.description,
      card.status,
      card.path,
      card.parentId || '',
    ];

    metadataKeys.forEach(key => {
      const value = card.metadata?.[key];
      if (Array.isArray(value)) {
        row.push(value.join(', '));
      } else {
        row.push(value ?? '');
      }
    });

    row.push(card.createdAt);
    row.push(card.updatedAt);

    worksheetData.push(row);
  });

  // Create workbook
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

  // Set column widths
  const columnWidths = headers.map((_, index) => {
    if (index === 0) return { wch: 30 }; // ID
    if (index === 1) return { wch: 40 }; // Title
    if (index === 2) return { wch: 50 }; // Description
    return { wch: 20 };
  });
  worksheet['!cols'] = columnWidths;

  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Cards');

  // Write file
  XLSX.writeFile(workbook, filename);
}

/**
 * Export visible columns only
 */
export function exportVisibleColumns(
  cards: KanbanCard[],
  visibleColumns: string[],
  format: 'csv' | 'excel',
  filename?: string
): void {
  // Filter cards to only include visible column data
  const filteredData = cards.map(card => {
    const filtered: any = {};
    
    visibleColumns.forEach(col => {
      if (col in card) {
        filtered[col] = card[col as keyof KanbanCard];
      } else if (card.metadata && col in card.metadata) {
        filtered[col] = card.metadata[col];
      }
    });
    
    return filtered as KanbanCard;
  });

  if (format === 'excel') {
    exportToExcel(filteredData, filename);
  } else {
    exportToCSV(filteredData, filename);
  }
}

/**
 * Helper to download file
 */
function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Group cards by a specific field
 */
export interface GroupedData {
  groupValue: string;
  cards: KanbanCard[];
  count: number;
}

export function groupCardsByField(cards: KanbanCard[], fieldId: string): GroupedData[] {
  const groups = new Map<string, KanbanCard[]>();

  cards.forEach(card => {
    let value: any;
    
    if (fieldId in card) {
      value = card[fieldId as keyof KanbanCard];
    } else {
      value = card.metadata?.[fieldId];
    }

    const groupKey = value != null ? String(value) : '(Empty)';
    
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    
    groups.get(groupKey)!.push(card);
  });

  return Array.from(groups.entries()).map(([groupValue, cards]) => ({
    groupValue,
    cards,
    count: cards.length,
  }));
}

/**
 * Multi-level grouping
 */
export interface MultiLevelGroup {
  groupValue: string;
  level: number;
  cards: KanbanCard[];
  subGroups?: MultiLevelGroup[];
  count: number;
}

export function groupCardsByMultipleFields(
  cards: KanbanCard[],
  fieldIds: string[]
): MultiLevelGroup[] {
  if (fieldIds.length === 0) {
    return [];
  }

  function groupByLevel(cards: KanbanCard[], level: number): MultiLevelGroup[] {
    const fieldId = fieldIds[level];
    const grouped = groupCardsByField(cards, fieldId);

    return grouped.map(group => {
      const result: MultiLevelGroup = {
        groupValue: group.groupValue,
        level,
        cards: group.cards,
        count: group.count,
      };

      // Recursively group sub-levels
      if (level < fieldIds.length - 1) {
        result.subGroups = groupByLevel(group.cards, level + 1);
      }

      return result;
    });
  }

  return groupByLevel(cards, 0);
}

/**
 * Flatten multi-level groups to flat array for rendering
 */
export function flattenGroups(groups: MultiLevelGroup[]): MultiLevelGroup[] {
  const flattened: MultiLevelGroup[] = [];

  function flatten(group: MultiLevelGroup) {
    flattened.push(group);
    if (group.subGroups) {
      group.subGroups.forEach(flatten);
    }
  }

  groups.forEach(flatten);
  return flattened;
}
