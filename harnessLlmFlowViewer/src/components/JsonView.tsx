import { JsonView as JV, allExpanded, collapseAllNested, darkStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';

interface Props {
  data: any;
  expandAll?: boolean;
}

export function JsonView({ data, expandAll = false }: Props) {
  return (
    <div className="json-view bg-ink-900 border border-ink-700 rounded-md p-3 max-h-[60vh] overflow-auto">
      <JV
        data={data}
        shouldExpandNode={expandAll ? allExpanded : collapseAllNested}
        style={{
          ...darkStyles,
          container: 'json-view-container',
          basicChildStyle: 'json-view-row',
          label: 'json-view-label',
          stringValue: 'json-view-string',
          numberValue: 'json-view-number',
          booleanValue: 'json-view-boolean',
          nullValue: 'json-view-null',
          undefinedValue: 'json-view-undefined',
          punctuation: 'json-view-punctuation',
          collapseIcon: 'json-view-collapse',
          expandIcon: 'json-view-expand',
          collapsedContent: 'json-view-collapsed',
          noQuotesForStringValues: false,
        } as any}
      />
    </div>
  );
}
