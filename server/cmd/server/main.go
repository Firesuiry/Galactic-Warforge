package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"siliconworld/internal/config"
	"siliconworld/internal/gamecore"
	"siliconworld/internal/gateway"
	"siliconworld/internal/queue"
)

func main() {
	cfgPath := flag.String("config", "config.yaml", "path to config file")
	flag.Parse()

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	log.Printf("SiliconWorld server starting")
	log.Printf("  players: %d", len(cfg.Players))
	log.Printf("  tick rate: %d/s", cfg.Battlefield.MaxTickRate)
	log.Printf("  map: %dx%d", cfg.Battlefield.MapWidth, cfg.Battlefield.MapHeight)
	log.Printf("  port: %d", cfg.Server.Port)

	// Wire up dependencies
	q := queue.New()
	bus := gamecore.NewEventBus()
	core := gamecore.New(cfg, q, bus)
	srv := gateway.New(cfg, core, bus, q)

	// Start tick loop
	go core.Run()

	// Start HTTP server
	httpSrv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Server.Port),
		Handler:      srv.Handler(),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 0, // SSE needs no write timeout
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		log.Printf("HTTP listening on %s", httpSrv.Addr)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http server: %v", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("shutting down...")
	core.Stop()
	log.Println("done")
}
