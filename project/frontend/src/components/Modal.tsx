import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

type ModalProps = {
    show: boolean;
    title: React.ReactNode;
    onClose: () => void;
    onConfirm?: () => void;
    children?: React.ReactNode;
    footer?: React.ReactNode;
    size?: 'sm' | 'lg' | 'xl';
    centered?: boolean;
    backdrop?: 'static' | true | false;
    zIndexBase?: number;
    className?: string;
    dialogClassName?: string;
    contentClassName?: string;
    confirmButtonClassName?: string;
    confirmButtonLabel?: string;
    confirmButtonDisabled?: boolean;
};

export default function Modal({
    show,
    title,
    onClose,
    onConfirm,
    children,
    footer,
    size,
    centered = true,
    backdrop = 'static',
    zIndexBase = 1500,
    className = '',
    dialogClassName = '',
    contentClassName = '',
    confirmButtonClassName = '',
    confirmButtonLabel = 'Close',
    confirmButtonDisabled = false
}: ModalProps) {
    useEffect(() => {
        if (!show) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' || e.key === 'Esc') {
                onClose?.();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [show, onClose]);

    if (!show) return null;

    const dialogClasses = [
        'modal-dialog',
        centered ? 'modal-dialog-centered' : '',
        size ? `modal-${size}` : '',
        dialogClassName,
    ].filter(Boolean).join(' ');

    const modalClasses = ['modal', 'show', 'd-block', className].filter(Boolean).join(' ');

    const handleBackdropClick = backdrop === true ? onClose : undefined;

    return createPortal(
        <>
            {backdrop !== false && (
                <div
                    className="modal-backdrop fade show"
                    style={{ zIndex: zIndexBase, background: 'rgba(0,0,0,0.7)' }}
                    onClick={handleBackdropClick}
                />
            )}
            <div
                className={modalClasses}
                role="dialog"
                aria-modal="true"
                style={{ zIndex: zIndexBase + 5 }}
            >
                <div className={dialogClasses}  onClick={(e) => e.stopPropagation()}>
                    <div className={['modal-content', contentClassName].filter(Boolean).join(' ')}>
                        <div className="modal-header">
                            <h5 className="modal-title">{title}</h5>
                            <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
                        </div>
                        <div className="modal-body">{children}</div>
                        <div className="modal-footer">
                            {footer ?? <button className={`btn btn-secondary ${confirmButtonClassName}`} 
                                            disabled={confirmButtonDisabled}
                                            onClick={() => (onConfirm ? onConfirm() : onClose())}>{confirmButtonLabel}
                                       </button>}
                        </div>
                    </div>
                </div>
            </div>
        </>,
        document.body
    );
}
