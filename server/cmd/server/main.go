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

	"siliconworld/internal/gateway"
	"siliconworld/internal/startup"
)

func main() {
	cfgPath := flag.String("config", "config.yaml", "path to config file")
	mapCfgPath := flag.String("map-config", "map.yaml", "path to map config file")
	flag.Parse()

	app, err := startup.LoadRuntime(*cfgPath, *mapCfgPath)
	if err != nil {
		log.Fatalf("load runtime: %v", err)
	}

	primary := app.Maps.PrimaryPlanet()
	primarySize := "unknown"
	if primary != nil {
		primarySize = fmt.Sprintf("%dx%d", primary.Width, primary.Height)
	}

	log.Printf("SiliconWorld server starting")
	log.Printf("  players: %d", len(app.Config.Players))
	log.Printf("  tick rate: %d/s", app.Config.Battlefield.MaxTickRate)
	log.Printf("  systems: %d", len(app.Maps.SystemOrder))
	log.Printf("  primary planet: %s", primarySize)
	log.Printf("  port: %d", app.Config.Server.Port)
	log.Printf("  data dir: %s", app.Config.Server.DataDir)

	srv := gateway.New(app.Config, app.Core, app.Bus, app.Queue)

	go app.Core.Run()

	httpSrv := &http.Server{
		Addr:         fmt.Sprintf(":%d", app.Config.Server.Port),
		Handler:      srv.Handler(),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 0,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		log.Printf("HTTP listening on %s", httpSrv.Addr)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http server: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("shutting down...")
	app.Stop()
	log.Println("done")
}
