'use client';

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';

export interface PreviewableDocument {
  file_url: string;
  file_name?: string | null;
  document_type: string;
}

function isPdf(doc: PreviewableDocument) {
  const name = (doc.file_name ?? doc.file_url).toLowerCase();
  return name.endsWith('.pdf');
}

// Shared inline viewer for uploaded customer documents (ID, clearance, 2x2
// photo, etc.) — images and PDFs render directly in the dialog instead of
// linking out to the raw file URL, which either downloads or opens a bare
// browser tab depending on the file type and storage headers.
export function DocumentPreviewDialog({ doc, onClose }: { doc: PreviewableDocument | null; onClose: () => void }) {
  return (
    <Dialog open={!!doc} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        {doc && (
          <>
            <DialogHeader>
              <DialogTitle className="capitalize">{doc.document_type.replace(/_/g, ' ')}</DialogTitle>
              {doc.file_name && <DialogDescription>{doc.file_name}</DialogDescription>}
            </DialogHeader>
            <div className="flex items-center justify-center bg-secondary/30 rounded-lg overflow-hidden" style={{ minHeight: 300 }}>
              {isPdf(doc) ? (
                <iframe src={doc.file_url} title={doc.document_type} className="w-full" style={{ height: '70vh', border: 'none' }} />
              ) : (
                <img src={doc.file_url} alt={doc.document_type} className="max-w-full object-contain" style={{ maxHeight: '70vh' }} />
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
