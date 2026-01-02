"use client";

import React, { ReactNode, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface SettingsLayoutProps {
  children: ReactNode;
}

const navItems = [{ href: "/settings/privacy", label: "隱私設定", icon: "🔒" }];

export default function SettingsLayout({ children }: SettingsLayoutProps) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-8">設定</h1>

        <div className="flex flex-col md:flex-row gap-8">
          {/* Side Navigation */}
          <nav className="w-full md:w-64 flex-shrink-0">
            <ul className="bg-gray-800 rounded-lg overflow-hidden">
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                        isActive
                          ? "bg-purple-600 text-white"
                          : "hover:bg-gray-700 text-gray-300"
                      }`}
                    >
                      <span>{item.icon}</span>
                      <span>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Main Content */}
          <main className="flex-1 bg-gray-800 rounded-lg p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
