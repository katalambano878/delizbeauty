'use client';

import { useState, useEffect } from 'react';

export default function MaintenanceMode() {
    // We'll simulate a 4-hour countdown for the animation
    const [timeLeft, setTimeLeft] = useState(() => {
        return {
            hours: 4,
            minutes: 0,
            seconds: 0,
        };
    });

    useEffect(() => {
        // Generate a target time 4 hours from initial mount to keep the countdown running
        const target = new Date().getTime() + 4 * 60 * 60 * 1000;

        const interval = setInterval(() => {
            const now = new Date().getTime();
            const difference = target - now;

            if (difference <= 0) {
                clearInterval(interval);
                setTimeLeft({ hours: 0, minutes: 0, seconds: 0 });
                return;
            }

            const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((difference % (1000 * 60)) / 1000);

            setTimeLeft({ hours, minutes, seconds });
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    const formatNumber = (num: number) => num.toString().padStart(2, '0');

    return (
        <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center relative overflow-hidden font-sans text-white">
            {/* Background Orbs & Effects */}
            <div className="absolute top-[-20%] left-[-10%] w-[50vw] h-[50vw] bg-purple-600/20 blur-[150px] rounded-full pointer-events-none" />
            <div className="absolute bottom-[-20%] right-[-10%] w-[60vw] h-[60vw] bg-blue-600/10 blur-[150px] rounded-full pointer-events-none" />
            <div className="absolute top-[20%] right-[10%] w-[30vw] h-[30vw] bg-rose-500/10 blur-[120px] rounded-full pointer-events-none" />
            {/* Content Container */}
            <div className="z-10 flex flex-col items-center text-center px-6 max-w-4xl mx-auto w-full">
                {/* Logo or Icon */}
                <div className="w-20 h-20 bg-white/5 border border-white/10 rounded-2xl backdrop-blur-md flex items-center justify-center mb-10 shadow-[0_0_40px_rgba(255,255,255,0.05)]">
                    <i className="ri-tools-fill text-4xl text-white/80"></i>
                </div>

                <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-br from-white via-white/90 to-white/40 leading-tight">
                    System Upgrade
                </h1>

                <p className="text-lg md:text-xl text-gray-400 mb-14 max-w-2xl font-light leading-relaxed">
                    We are currently performing scheduled maintenance to bring you an extraordinary, next-generation experience. The store will be right back online shortly.
                </p>

                {/* Countdown Area */}
                <div className="flex items-center justify-center gap-4 md:gap-8 mb-16">
                    <CountdownBox label="Hours" value={formatNumber(timeLeft.hours)} />
                    <span className="text-4xl md:text-6xl font-light text-white/20 -mt-8">:</span>
                    <CountdownBox label="Minutes" value={formatNumber(timeLeft.minutes)} />
                    <span className="text-4xl md:text-6xl font-light text-white/20 -mt-8">:</span>
                    <CountdownBox label="Seconds" value={formatNumber(timeLeft.seconds)} />
                </div>

                {/* Footer info / Decorative Line */}
                <div className="w-full max-w-md">
                    <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-white/10 to-transparent mb-8" />
                    <p className="text-sm text-gray-500 uppercase tracking-widest font-medium">
                        God-Level Shopping Awaits
                    </p>
                </div>
            </div>
        </div>
    );
}

function CountdownBox({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex flex-col items-center">
            <div className="w-24 h-24 md:w-32 md:h-32 bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-3xl flex items-center justify-center mb-4 relative overflow-hidden group shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
                {/* Inner glow effect on hover via css */}
                <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <span className="text-5xl md:text-7xl font-light tracking-tighter text-white font-mono drop-shadow-[0_0_20px_rgba(255,255,255,0.3)]">
                    {value}
                </span>
            </div>
            <span className="text-xs md:text-sm text-gray-400 font-medium uppercase tracking-[0.2em]">
                {label}
            </span>
        </div>
    );
}
